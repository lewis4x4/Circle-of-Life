/**
 * COL-656: the neon/monospace "engine" KPI tiles (V2Card + MonolithicWatermark +
 * 10px mono ALL-CAPS labels) are replaced by the design-system KPITile and the
 * page title by PageHeader. Converted pages must not drift back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CONVERTED = [
  "src/components/schedules/AdminSchedulesPageClient.tsx",
  "src/app/(admin)/time-records/page.tsx",
  "src/app/(admin)/admin/quality/page.tsx",
];

describe("engine tiles converted to KPITile (COL-656)", () => {
  it.each(CONVERTED)("%s uses KPITile and PageHeader, not the engine template", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    expect(source).toContain("<KPITile");
    expect(source).toContain("<PageHeader");
    expect(source).not.toMatch(/MonolithicWatermark|<V2Card|KineticGrid/);
    expect(source).not.toMatch(/text-4xl font-mono/);
    expect(source).not.toMatch(/Schedule Engine|Initialize Week/);
  });
});
