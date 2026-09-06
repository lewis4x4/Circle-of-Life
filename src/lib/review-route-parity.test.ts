import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routes = ["", "residents", "residents/[id]", "residents/new", "admissions", "admissions/[id]", "admissions/new", "incidents", "incidents/[id]", "incidents/new", "executive", "executive/reports", "executive/standup", "executive/benchmarks", "quality", "rounding", "finance/ledger", "finance/trial-balance", "settings/users"];
describe("reviewed routes retain operational capability", () => {
  it.each(routes)("%s resolves to the complete task implementation", (route) => {
    const file = path.resolve("src/app/(admin)/admin/v2", route, "page.tsx");
    const source = fs.readFileSync(file, "utf8");
    const target = source.match(/export \{ default \} from "([^"]+)"/);
    expect(target, "Canonical route must share the working implementation instead of a placeholder").not.toBeNull();
    if (target) expect(fs.existsSync(path.resolve(path.dirname(file), `${target[1]}.tsx`))).toBe(true);
  });
});


describe("restored route provider parity", () => {
  it.each(["quality", "residents/[id]", "admissions", "executive/reports"])("%s keeps its original layout", (route) => {
    const file = path.resolve("src/app/(admin)/admin/v2", route, "layout.tsx");
    const source = fs.readFileSync(file, "utf8");
    const target = source.match(/export \{ default \} from "([^"]+)"/);
    expect(target).not.toBeNull();
    if (target) expect(fs.existsSync(path.resolve(path.dirname(file), `${target[1]}.tsx`))).toBe(true);
  });
});
