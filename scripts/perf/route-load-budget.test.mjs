import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { duplicateRequests, evaluateSamples, loadBudget } from "./route-load-budget.mjs";

function budgetFile(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "route-budget-"));
  const file = path.join(dir, "budget.json");
  writeFileSync(file, JSON.stringify(body));
  return file;
}

test("the checked-in budget covers every COL-660 route at 5 s or less", () => {
  const { routes } = loadBudget(path.resolve("perf-route-budget.json"));
  const byPath = new Map(routes.map((r) => [r.path, r.budgetMs]));
  for (const route of [
    "/admin/rounding/reports",
    "/admin/operations/vendors",
    "/admin/admissions",
    "/admin/referrals/sources",
    "/admin/nurse-dashboard",
    "/admin/residents/board-check",
    "/admin/infection-control/staff-illness",
  ]) {
    assert.ok(byPath.has(route), `${route} has no budget`);
    assert.ok(byPath.get(route) <= 5000, `${route} budget is over 5 s`);
  }
});

test("per-route budgets override the default and bad entries are refused", () => {
  const file = budgetFile({ defaultContentReadyMs: 5000, routes: ["/a", { path: "/b", contentReadyMs: 1200 }] });
  assert.deepEqual(loadBudget(file).routes, [{ path: "/a", budgetMs: 5000 }, { path: "/b", budgetMs: 1200 }]);
  assert.throws(() => loadBudget(budgetFile({ defaultContentReadyMs: 0, routes: ["/a"] })));
  assert.throws(() => loadBudget(budgetFile({ defaultContentReadyMs: 5000, routes: ["a"] })));
  assert.throws(() => loadBudget(budgetFile({ defaultContentReadyMs: 5000, routes: [] })));
});

test("over-budget and never-ready samples fail; duplicates are reported", () => {
  const failures = evaluateSamples([
    { route: "/a", contentReadyMs: 900, budgetMs: 5000, error: null },
    { route: "/b", contentReadyMs: 5001, budgetMs: 5000, error: null },
    { route: "/c", contentReadyMs: 45000, budgetMs: 5000, error: "Timeout" },
  ]);
  assert.deepEqual(failures.map((f) => f.route), ["/b", "/c"]);
  assert.deepEqual(duplicateRequests(["GET /x?a=1", "GET /x?a=1", "GET /x?a=2"]), [{ url: "GET /x?a=1", n: 2 }]);
});
