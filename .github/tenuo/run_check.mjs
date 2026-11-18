// GitHub Actions entry point: read the PR's comments, run the gate, report a check run.
import { readFileSync } from "node:fs";
import { evaluate } from "./gate.mjs";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const REPO = process.env.GITHUB_REPOSITORY;
const CHECK_NAME = "tenuo/agent-review";

async function gh(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const number = (event.pull_request ?? event.issue)?.number;
if (!number || (event.issue && !event.issue.pull_request)) {
  console.log("not a pull request event");
  process.exit(0);
}
const pr = await gh("GET", `/repos/${REPO}/pulls/${number}`);
if (pr.state !== "open") {
  console.log("pull request is not open");
  process.exit(0);
}
const headSha = pr.head.sha;
const bodies = [];
for (let page = 1; ; page += 1) {
  const batch = await gh("GET", `/repos/${REPO}/issues/${number}/comments?per_page=100&page=${page}`);
  bodies.push(...batch.map((c) => c.body));
  if (batch.length < 100) break;
}
const config = JSON.parse(readFileSync(new URL("../tenuo-review.json", import.meta.url), "utf8"));
const verdict = evaluate(config.trusted_roots, bodies, REPO, number, headSha);
console.log(JSON.stringify(verdict, null, 1));
await gh("POST", `/repos/${REPO}/check-runs`, {
  name: CHECK_NAME,
  head_sha: headSha,
  status: "completed",
  conclusion: verdict.passed ? "success" : "failure",
  output: {
    title: verdict.summary.slice(0, 250),
    summary: verdict.details.map((d) => `- ${d}`).join("\n") || verdict.summary,
  },
});
