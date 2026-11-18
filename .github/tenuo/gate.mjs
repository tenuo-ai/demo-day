// Signed agent review gate.
//
// Passes a pull request only when the merge warrant posted on it, checked
// against the instance's public key, is satisfied by signed approvals for this
// exact merge: this repository, this pull request, this head commit. The
// author's own key is never an approver in its warrant.
//
// Comments carry no trust of their own. The decision is Tenuo's
// checkWithoutPop(): chain against the trusted root, constraints, approval
// gate, and each approval's signature, expiry and binding. The arguments being
// approved come from GitHub, not from comments. The rest of this file only
// finds the inputs and explains the outcome.

import { createTenuo } from "@tenuo/core";

export const TOOL = "merge_pr";
const MARKER = /<!--\s*tenuo:(merge-warrant|approval)\s+v1\s*-->/;
const JSON_BLOCK = /```json\s*(\{[\s\S]*?\})\s*```/;

export function parseComments(bodies) {
  const warrants = [];
  const approvals = [];
  for (const body of bodies) {
    const m = MARKER.exec(body ?? "");
    const j = JSON_BLOCK.exec(body ?? "");
    if (!m || !j) continue;
    let data;
    try {
      data = JSON.parse(j[1]);
    } catch {
      continue;
    }
    if (m[1] === "merge-warrant" && typeof data.warrant === "string") warrants.push(data.warrant);
    if (m[1] === "approval" && typeof data.approval === "string") approvals.push(data.approval);
  }
  return { warrants, approvals };
}

// Human-readable reasons for approvals that did not count. Explanation only.
function explainApprovals(warrant, approvals) {
  let leaf;
  try {
    leaf = createTenuo.inspectWarrant(warrant).at(-1);
  } catch {
    return [];
  }
  const reasons = [];
  for (const envelope of approvals) {
    let info;
    try {
      info = createTenuo.inspectApproval(envelope);
    } catch {
      reasons.push("an unreadable approval");
      continue;
    }
    const who = info.externalId || info.approverPublicKey.slice(0, 12);
    if (!info.signatureValid) reasons.push(`${who}: invalid signature`);
    else if (info.expired) reasons.push(`${who}: approval expired`);
    else if (info.approverPublicKey === leaf?.holderPublicKey) reasons.push(`${who}: the merge holder cannot approve its own merge`);
    else if (!leaf?.requiredApprovers.includes(info.approverPublicKey)) reasons.push(`${who}: not an approver listed in the merge warrant`);
    else reasons.push(`${who}: approved a different merge (older commit, other PR, or other warrant)`);
  }
  return reasons;
}

function approverNames(approvals) {
  const names = new Map();
  for (const envelope of approvals) {
    try {
      const info = createTenuo.inspectApproval(envelope);
      names.set(info.approverPublicKey, info.externalId || info.approverPublicKey.slice(0, 12));
    } catch {
      // unreadable: already counted as rejected by the check
    }
  }
  return names;
}

export function evaluate(trustedRootsHex, bodies, repo, pr, headSha) {
  const checker = createTenuo({ trustedRoots: trustedRootsHex.map((h) => createTenuo.publicKeyFromHex(h)) });
  const args = { repo, pr: String(pr), head_sha: headSha };
  const { warrants, approvals } = parseComments(bodies);
  if (warrants.length === 0) return { passed: false, summary: "no merge warrant on this pull request", details: [] };
  const details = [];
  for (const warrant of warrants) {
    let r;
    try {
      r = checker.checkWithoutPop(warrant, TOOL, args, { approvals });
    } catch (e) {
      details.push(`warrant rejected: ${e.message}`);
      continue;
    }
    if (r.outcome === "allow" && r.approvals && r.approvals.valid >= 1) {
      // Name only the approvals that verify for this merge.
      const counted = approvals.filter((a) => checker.checkWithoutPop(warrant, TOOL, args, { approvals: [a] }).approvals?.valid === 1);
      const names = [...approverNames(counted).values()].sort();
      const summary = `approved by ${names.join(", ")} (${r.approvals.valid}/${r.approvals.required})`;
      details.push(summary);
      return { passed: true, summary, details };
    }
    if (r.outcome === "allow") {
      details.push("warrant does not gate merges on approval; refusing");
      continue;
    }
    if (!r.chainValid) {
      details.push(`warrant rejected: ${r.message ?? r.code}`);
    } else if (r.outcome === "deny") {
      details.push(`warrant does not cover this merge: ${r.message ?? r.code}`);
    } else {
      const reasons = explainApprovals(warrant, approvals);
      details.push(`${r.approvals?.valid ?? 0}/${r.approvals?.required ?? 1} valid approvals${reasons.length ? ` (${reasons.join("; ")})` : ""}`);
    }
  }
  return { passed: false, summary: details.at(-1), details };
}
