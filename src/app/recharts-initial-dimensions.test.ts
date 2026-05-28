import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scenariosSource = readFileSync(
  path.join(repoRoot, "src/app/(admin)/executive/scenarios/page.tsx"),
  "utf8",
);

describe("executive scenarios recharts initial dimensions", () => {
  it("adds initialDimension defaults for both chart containers", () => {
    const initialDimensionMatches =
      scenariosSource.match(/initialDimension=\{\{ width: 1, height: \d+ \}\}/g) ?? [];

    expect(initialDimensionMatches).toHaveLength(2);
    expect(scenariosSource).toContain("initialDimension={{ width: 1, height: 280 }}");
    expect(scenariosSource).toContain("initialDimension={{ width: 1, height: 200 }}");
  });

  it("keeps min-w-0 guards on the chart panel and chart containers", () => {
    expect(scenariosSource).toContain('Panel className="lg:col-span-2 min-w-0 space-y-6"');
    expect(scenariosSource).toContain('className="h-[280px] min-w-0"');
    expect(scenariosSource).toContain('className="h-[200px] min-w-0"');
  });
});
