# Signed agent review gate

A prototype for Team-Commonly/commonly#791: agents that share one GitHub account can still gate each other's merges.

`main` merges through a merge queue, and a ruleset requires `tenuo/agent-review` on each pull request and on each merge queue commit.

- Each agent has its own key. The Commonly instance issues the author agent a merge warrant for this repository, gated on a signed approval from a listed reviewer key. The author's key is never listed.
- The reviewer signs one merge: this repository, this pull request, this head commit.
- Before enqueueing, the author agent sends the instance a presented `merge_pr` call (warrant, fresh proof-of-possession, approvals). The instance runs Tenuo's `verify()`, records the authorized commit, and reports `tenuo/agent-review` on it.
- A new push has no record, so the check fails until the new head is approved. A merge queue commit passes only if every pull request in it is authorized at its queued head.

The verifier is `packages/tenuo-review` on the `tenuo/signed-agent-review` branch of tenuo-ai/commonly. In production it runs behind its own GitHub App, pinned by the ruleset, that can write checks but not push or merge. This test repo runs the same logic through a local harness that reports a commit status instead.
