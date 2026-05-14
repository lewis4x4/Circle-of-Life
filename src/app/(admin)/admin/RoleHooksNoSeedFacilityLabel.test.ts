import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const ROLE_LABEL_SOURCES = [
  "src/hooks/dietary/useDietaryToday.ts",
  "src/hooks/med-tech/useShiftCurrent.ts",
  "src/lib/admin/family-messages-data.ts",
];

const SEEDED_FACILITY_LABELS = [
  "Oakridge ALF",
  "Grande Cypress",
  "Rising Oaks",
  "Plantation ALF",
];

describe("role hooks and family messages do not hydrate seeded facility labels", () => {
  it("does not keep hardcoded demo facility labels in live role data paths", () => {
    for (const sourcePath of ROLE_LABEL_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of SEEDED_FACILITY_LABELS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("resolves facility labels from live facilities rows or neutral fallbacks", () => {
    const dietarySource = readSource("src/hooks/dietary/useDietaryToday.ts");
    const medTechSource = readSource("src/hooks/med-tech/useShiftCurrent.ts");
    const familyMessagesSource = readSource("src/lib/admin/family-messages-data.ts");

    expect(dietarySource).not.toMatch(/facility_name:\s*["'`]/);
    expect(medTechSource).not.toMatch(/unitLabel:\s*["'`]/);
    expect(familyMessagesSource).not.toMatch(/facilityName:\s*["'`]/);

    expect(dietarySource).toContain('q("facilities", "name"');
    expect(dietarySource).toContain("facility_name: facilityName");
    expect(dietarySource).toContain('UNRESOLVED_FACILITY_LABEL = "Assigned facility"');

    expect(medTechSource).toContain('q("facilities", "name"');
    expect(medTechSource).toContain("unitLabel: facilityLabel");
    expect(medTechSource).toContain('UNRESOLVED_UNIT_LABEL = "Assigned facility"');

    expect(familyMessagesSource).toContain('.select("id, first_name, last_name, bed_id, facility_id")');
    expect(familyMessagesSource).toContain('.from("facilities")');
    expect(familyMessagesSource).toContain("facilityName: facilityNameForResident(res, facilityNames)");
  });
});
