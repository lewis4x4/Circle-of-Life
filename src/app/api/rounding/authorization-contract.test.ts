import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = [
  "escalations/[id]/route.ts",
  "generate-tasks/route.ts",
  "integrity-flags/[id]/route.ts",
  "integrity-flags/history/route.ts",
  "plans/apply-discovery-default/route.ts",
  "plans/route.ts",
  "plans/templates/route.ts",
  "reports/completion/route.ts",
  "tasks/[id]/complete/route.ts",
  "tasks/[id]/excuse/route.ts",
  "tasks/[id]/reassign/route.ts",
  "tasks/route.ts",
  "vocabulary/route.ts",
  "watch-instances/[id]/route.ts",
] as const;

const MUTATION_ROUTES = [
  "escalations/[id]/route.ts",
  "generate-tasks/route.ts",
  "integrity-flags/[id]/route.ts",
  "plans/apply-discovery-default/route.ts",
  "plans/route.ts",
  "tasks/[id]/complete/route.ts",
  "tasks/[id]/excuse/route.ts",
  "tasks/[id]/reassign/route.ts",
  "watch-instances/[id]/route.ts",
] as const;

function source(file: string) {
  return readFileSync(resolve(process.cwd(), "src/app/api/rounding", file), "utf8");
}

describe("rounding route current-authority contract", () => {
  it.each(ROUTES)("%s resolves the shared current actor before privileged reads", (file) => {
    const route = source(file);
    expect(route).toContain("getRoundingRequestContext(");
    expect(route).toContain('if ("response" in auth) return auth.response');
  });

  it.each(MUTATION_ROUTES)("%s revalidates immediately before its mutation phase", (file) => {
    const route = source(file);
    const revalidateAt = route.lastIndexOf("revalidateRoundingRequestContext(");
    const firstMutationAt = [".insert(", ".update(", ".upsert(", ".rpc("]
      .map((needle) => route.indexOf(needle, revalidateAt))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    expect(revalidateAt).toBeGreaterThan(0);
    expect(firstMutationAt).toBeGreaterThan(revalidateAt);
  });

  it.each([
    "escalations/[id]/route.ts",
    "integrity-flags/[id]/route.ts",
    "plans/route.ts",
    "tasks/[id]/complete/route.ts",
    "tasks/[id]/excuse/route.ts",
    "tasks/[id]/reassign/route.ts",
    "watch-instances/[id]/route.ts",
  ])("%s constrains ID-only initial reads to current facility scope", (file) => {
    const route = source(file);
    expect(route).toContain("getAccessibleRoundingFacilityIds(context)");
    expect(route).toContain('.in("facility_id", accessibleFacilityIds)');
  });
});
