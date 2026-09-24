import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FAMILY_CONNECTIONS_VIEWS, familyConnectionsView } from "@/lib/family/family-connections-views";
import { PILLARS } from "@/lib/navigation/pillars";

describe("Family Connections views (COL-707)", () => {
  it("offers Connections and Family notes, defaulting to Connections", () => {
    expect(FAMILY_CONNECTIONS_VIEWS.map((v) => v.label)).toEqual(["Connections", "Family notes"]);
    expect(familyConnectionsView("notes")).toBe("notes");
    expect(familyConnectionsView(null)).toBe("connections");
    expect(familyConnectionsView("anything")).toBe("connections");
  });

  it("renders the Family notes panel inside the Family Connections page", () => {
    const page = readFileSync(path.resolve(import.meta.dirname, "../../app/(admin)/admin/family-portal/page.tsx"), "utf8");
    expect(page).toContain('view === "notes" ? <FamilyNotesPanel /> : <FamilyConnectionsOverview />');
  });

  it("has one family entry in the rail, pointing at Family Connections", () => {
    const family = PILLARS.flatMap((p) => p.items).filter((item) => /family/i.test(item.label));
    expect(family.map((item) => item.href)).toEqual(["/admin/family-portal"]);
  });
});
