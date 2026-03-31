/**
 * Optional smoke tests after `npm run design:review`.
 * Run: node --test .agents/design-review.spec.js
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("path");

const reportPath = path.join(
  __dirname,
  "..",
  "test-results",
  "design-review",
  "report.json",
);

test("design review report exists (when design gate ran)", (t) => {
  if (!fs.existsSync(reportPath)) {
    t.skip("no report yet — run npm run design:review first");
    return;
  }
  const raw = fs.readFileSync(reportPath, "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.shots), "report.shots should be an array");
});
