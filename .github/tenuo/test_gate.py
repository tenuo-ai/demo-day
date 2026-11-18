"""Cross-language test: warrants and approvals minted by the TypeScript SDK
(packages/tenuo-review in the Commonly fork, test/make-fixture.js), verified by
this Python gate. The fixture lives 90 days, the protocol maximum; regenerate it
before then."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gate import evaluate  # noqa: E402

F = json.loads((Path(__file__).parent / "fixture.json").read_text())
C = F["comments"]


def run(*names, sha=None, pr=None, repo=None):
    return evaluate(F["trusted_roots"], [C[n] for n in names], repo or F["repo"], pr or F["pr"], sha or F["head_sha"])


def test_reviewer_approval_passes():
    v = run("warrant", "good")
    assert v.passed, v
    assert "sprint-review" in v.summary


def test_no_warrant_fails():
    assert not run("good").passed


def test_no_approval_fails():
    assert not run("warrant").passed


def test_self_approval_fails():
    v = run("warrant", "self")
    assert not v.passed and "own merge" in v.summary, v


def test_unlisted_agent_fails():
    v = run("warrant", "outsider")
    assert not v.passed and "not an approver" in v.summary, v


def test_new_push_invalidates_approval():
    v = run("warrant", "good", sha=F["other_sha"])
    assert not v.passed and "different merge" in v.summary, v


def test_other_pr_fails():
    assert not run("warrant", "good", pr=F["pr"] + 1).passed


def test_other_repo_fails():
    v = run("warrant", "good", repo="Team-Commonly/commonly")
    assert not v.passed and "does not cover" in v.summary, v


def test_untrusted_issuer_fails_even_with_valid_approval():
    v = run("rogue_warrant", "rogue_good")
    assert not v.passed and "rejected" in v.summary, v


def test_good_approval_survives_noise():
    assert run("rogue_warrant", "self", "outsider", "warrant", "good").passed
