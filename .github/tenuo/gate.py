"""Signed agent review gate.

Passes a pull request only when a reviewer agent, other than the agent that
holds the merge warrant, has signed an approval for this exact merge:
this repository, this pull request, this head commit.

Inputs come from PR comments. Comments carry no trust of their own: a warrant
counts only if it chains to a trusted root, and an approval counts only if its
signer is listed as an approver in that warrant. The checker derives the
arguments being approved (repo, pr, head_sha) from GitHub, not from comments.

The merge itself is verified again at merge time with proof-of-possession by
whatever performs it (Commonly's broker). This check is the offline half: it
needs no holder key and no network call to the issuer.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass, field

import tenuo

TOOL = "merge_pr"
MARKER = re.compile(r"<!--\s*tenuo:(merge-warrant|approval)\s+v1\s*-->")
JSON_BLOCK = re.compile(r"```json\s*(\{.*?\})\s*```", re.S)


@dataclass
class Verdict:
    passed: bool
    summary: str
    details: list[str] = field(default_factory=list)


def _decode(s: str) -> bytes:
    s = s.strip()
    if re.fullmatch(r"[0-9a-fA-F]+", s) and len(s) % 2 == 0:
        return bytes.fromhex(s)
    if "-" in s or "_" in s:
        return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
    return base64.b64decode(s + "=" * (-len(s) % 4))


def parse_comments(bodies: list[str]) -> tuple[list[str], list[str]]:
    """Return (warrants, approvals) found in comment bodies."""
    warrants: list[str] = []
    approvals: list[str] = []
    for body in bodies:
        m = MARKER.search(body or "")
        j = JSON_BLOCK.search(body or "")
        if not m or not j:
            continue
        try:
            data = json.loads(j.group(1))
        except json.JSONDecodeError:
            continue
        if m.group(1) == "merge-warrant" and isinstance(data.get("warrant"), str):
            warrants.append(data["warrant"])
        if m.group(1) == "approval" and isinstance(data.get("approval"), str):
            approvals.append(data["approval"])
    return warrants, approvals


def check_one(authorizer, wire: str, args: dict, approvals: list[str], now: float) -> tuple[bool, str]:
    chain = tenuo.decode_warrant_stack_base64(wire)
    authorizer.verify_chain(chain)  # trusted root, links, signatures, narrowing only, expiry
    leaf = chain[-1]
    bad = leaf.check_constraints(TOOL, args)
    if bad is not None and bad is not True:
        return False, f"warrant does not cover this merge: {bad}"
    holder = leaf.authorized_holder.to_bytes()
    allowed = {k.to_bytes() for k in (leaf.required_approvers() or [])}
    need = leaf.min_approvals() or 1
    want = bytes(tenuo.compute_request_hash(leaf.id, TOOL, args, leaf.authorized_holder))

    signers: dict[bytes, str] = {}
    reasons: list[str] = []
    for a in approvals:
        try:
            signed = tenuo.SignedApproval.from_bytes(_decode(a))
            payload = signed.verify()  # approver signature over the payload
        except Exception as e:  # malformed or forged
            reasons.append(f"unreadable approval ({type(e).__name__})")
            continue
        key = signed.approver_key.to_bytes()
        who = payload.external_id or key.hex()[:12]
        if bytes(payload.request_hash) != want:
            reasons.append(f"{who}: approved a different merge (older commit, other PR, or other warrant)")
        elif payload.expires_at < now:
            reasons.append(f"{who}: approval expired")
        elif key == holder:
            reasons.append(f"{who}: the merge holder cannot approve its own merge")
        elif key not in allowed:
            reasons.append(f"{who}: not an approver listed in the merge warrant")
        else:
            signers[key] = who
    if len(signers) < need:
        return False, f"{len(signers)}/{need} valid approvals" + (f" ({'; '.join(reasons)})" if reasons else "")
    return True, f"approved by {', '.join(sorted(signers.values()))} ({len(signers)}/{need})"


def evaluate(trusted_roots_hex: list[str], bodies: list[str], repo: str, pr: int, head_sha: str,
             now: float | None = None) -> Verdict:
    now = time.time() if now is None else now
    roots = [tenuo.PublicKey.from_bytes(bytes.fromhex(h)) for h in trusted_roots_hex]
    authorizer = tenuo.Authorizer(trusted_roots=roots)
    args = {"repo": repo, "pr": str(pr), "head_sha": head_sha}
    warrants, approvals = parse_comments(bodies)
    if not warrants:
        return Verdict(False, "no merge warrant on this pull request")
    details: list[str] = []
    for w in warrants:
        try:
            ok, why = check_one(authorizer, w, args, approvals, now)
        except Exception as e:
            ok, why = False, f"warrant rejected: {type(e).__name__}: {str(e)[:200]}"
        details.append(why)
        if ok:
            return Verdict(True, why, details)
    return Verdict(False, details[-1], details)
