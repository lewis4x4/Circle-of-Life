import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const EXECUTIVE_CHART_SOURCES = [
  "src/components/executive/ceo-risk-index-chart.tsx",
  "src/components/executive/ceo-growth-funnel-chart.tsx",
  "src/components/executive/facility-drill-down.tsx",
];

const FORBIDDEN_MOCK_MARKERS = [
  "MOCK DATA GENERATOR",
  "generateMockRiskIndexData",
  "generateMockGrowthFunnelData",
  "generateMockFacilityDrillDownData",
  "Grande Cypress",
  "Oakridge",
  "Plantation",
  "Rising Oaks",
  "criticalIncidents: 12",
  "value: 85 + Math.random() * 10",
];

describe("executive chart components do not carry seeded mock generators", () => {
  it("keeps executive chart files free of exported mock datasets", () => {
    for (const sourcePath of EXECUTIVE_CHART_SOURCES) {
      const source = readSource(sourcePath);

      expect(source, `${sourcePath} exports a generated mock/demo/seed dataset`).not.toMatch(
        /export\s+function\s+generate\w*(Mock|Demo|Seed)\w*Data/,
      );
      expect(source, `${sourcePath} still contains a random fake data series`).not.toContain("Math.random(");

      for (const marker of FORBIDDEN_MOCK_MARKERS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toContain(marker);
      }
    }
  });
});
