"""GitHub Actions entry point: read the PR's comments, run the gate, report a check run."""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gate import evaluate  # noqa: E402

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
TOKEN = os.environ["GITHUB_TOKEN"]
REPO = os.environ["GITHUB_REPOSITORY"]
CHECK_NAME = "tenuo/agent-review"


def gh(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main() -> None:
    event = json.load(open(os.environ["GITHUB_EVENT_PATH"]))
    number = (event.get("pull_request") or event.get("issue") or {}).get("number")
    if not number or ("issue" in event and "pull_request" not in event["issue"]):
        print("not a pull request event")
        return
    pr = gh("GET", f"/repos/{REPO}/pulls/{number}")
    if pr["state"] != "open":
        print("pull request is not open")
        return
    head_sha = pr["head"]["sha"]
    bodies, page = [], 1
    while True:
        batch = gh("GET", f"/repos/{REPO}/issues/{number}/comments?per_page=100&page={page}")
        bodies += [c["body"] for c in batch]
        if len(batch) < 100:
            break
        page += 1
    config = json.load(open(Path(__file__).parent.parent / "tenuo-review.json"))
    verdict = evaluate(config["trusted_roots"], bodies, REPO, number, head_sha)
    print(json.dumps({"passed": verdict.passed, "summary": verdict.summary, "details": verdict.details}, indent=1))
    gh("POST", f"/repos/{REPO}/check-runs", {
        "name": CHECK_NAME,
        "head_sha": head_sha,
        "status": "completed",
        "conclusion": "success" if verdict.passed else "failure",
        "output": {"title": verdict.summary[:250],
                   "summary": "\n".join(f"- {d}" for d in verdict.details) or verdict.summary},
    })


if __name__ == "__main__":
    main()
