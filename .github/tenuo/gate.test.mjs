// Warrants and approvals minted by packages/tenuo-review in the Commonly fork
// (test/make-fixture.js), checked here by the same SDK the gate runs. The
// fixture lives 90 days, the protocol maximum; regenerate it before then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "./gate.mjs";

const F = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const C = F.comments;
const run = (names, o = {}) => evaluate(F.trusted_roots, names.map((n) => C[n]), o.repo ?? F.repo, o.pr ?? F.pr, o.sha ?? F.head_sha);

test("a listed reviewer's approval passes", () => {
  const v = run(["warrant", "good"]);
  assert.ok(v.passed, JSON.stringify(v));
  assert.match(v.summary, /sprint-review/);
});
test("no warrant fails", () => assert.ok(!run(["good"]).passed));
test("no approval fails", () => assert.ok(!run(["warrant"]).passed));
test("self-approval fails", () => {
  const v = run(["warrant", "self"]);
  assert.ok(!v.passed);
  assert.match(v.summary, /own merge/);
});
test("an unlisted agent fails", () => {
  const v = run(["warrant", "outsider"]);
  assert.ok(!v.passed);
  assert.match(v.summary, /not an approver/);
});
test("a new push invalidates the approval", () => {
  const v = run(["warrant", "good"], { sha: F.other_sha });
  assert.ok(!v.passed);
  assert.match(v.summary, /different merge/);
});
test("another PR fails", () => assert.ok(!run(["warrant", "good"], { pr: F.pr + 1 }).passed));
test("another repository fails", () => {
  const v = run(["warrant", "good"], { repo: "Team-Commonly/commonly" });
  assert.ok(!v.passed);
  assert.match(v.summary, /does not cover/);
});
test("an untrusted issuer fails even with a valid approval", () => {
  const v = run(["rogue_warrant", "rogue_good"]);
  assert.ok(!v.passed);
  assert.match(v.summary, /rejected/);
});
test("a good approval survives noise", () => assert.ok(run(["rogue_warrant", "self", "outsider", "warrant", "good"]).passed));
