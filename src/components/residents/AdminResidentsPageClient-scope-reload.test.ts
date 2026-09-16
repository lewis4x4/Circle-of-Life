import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rosterSource = readFileSync(
  path.resolve(import.meta.dirname, "./AdminResidentsPageClient.tsx"),
  "utf8",
);

/**
 * The roster is server-rendered for the facility in the scope cookie while the
 * header selector reads browser storage. When the two disagree (a page wrote
 * the selector without the cookie), the roster must reload for the selector's
 * facility on mount — otherwise it shows another facility's census under the
 * selected facility's name (2026-09-15: Grande Cypress's empty roster and 54
 * licensed beds rendered under "Homewood Lodge, ALF").
 */
describe("resident roster follows the facility selector", () => {
  it("reloads on mount and whenever the selected facility changes", () => {
    expect(rosterSource).toMatch(/useEffect\(\(\) => \{\s*void loadResidents\(\);\s*\}, \[loadResidents\]\);/);
  });

  it("skips the redundant reload only when the server already rendered the selected facility", () => {
    expect(rosterSource).toContain("const skipNextLoadRef = useRef(initialError == null);");
    expect(rosterSource).toContain("if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {");
    expect(rosterSource).toContain("}, [selectedFacilityId, initialFacilityId]);");
  });
});
