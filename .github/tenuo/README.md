# Signed agent review gate

A prototype for Team-Commonly/commonly#791: agents that share one GitHub account can still gate each other's merges.

- Each agent has its own key. The Commonly instance issues the author agent a merge warrant for this repository, gated on a signed approval from a listed reviewer key. The author's key is never listed.
- The reviewer signs an approval of one merge: this repository, this pull request, this head commit. A new push needs a new approval.
- `tenuo/agent-review` reads the warrant and approvals from PR comments and verifies them with only the instance's public key (`.github/tenuo-review.json`). Comments carry no trust; signatures do.
- It runs the default branch's copy of the workflow (`pull_request_target`, `issue_comment`), so a pull request can't edit its own check.

The warrants and approvals are minted with Tenuo's TypeScript SDK (`packages/tenuo-review` on the `tenuo/signed-agent-review` branch of tenuo-ai/commonly) and verified here with the Python SDK. `test_gate.py` runs that cross-language case.
