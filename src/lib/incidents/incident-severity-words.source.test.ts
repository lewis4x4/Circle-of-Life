import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatLevelWord, formatSeverityChoice, incidentSeverityOptions } from "@/lib/incidents/incidents-display-copy";

/**
 * Brian, 2026-09-23 (COL-689): incident severity is Note / Heads-up / Urgent / Emergency
 * everywhere, including the report form. The stored values stay level_1..level_4.
 */
const ROOT = path.resolve(__dirname, "../../..");

const SEVERITY_PICKERS = [
  "src/app/(admin)/incidents/new/page.tsx",
  "src/components/med-tech/IncidentModal.tsx",
  "src/app/(admin)/admin/settings/notifications/page.tsx",
  "src/components/v2/forms/NewIncidentForm.tsx",
];

describe("incident severity words (COL-689)", () => {
  it("maps each stored level to one word", () => {
    expect(["level_1", "level_2", "level_3", "level_4"].map(formatLevelWord)).toEqual([
      "Note",
      "Heads-up",
      "Urgent",
      "Emergency",
    ]);
  });

  it("leads every picker choice with the word", () => {
    expect(formatSeverityChoice("level_2")).toBe("Heads-up — minor injury or a repeat event");
    expect(incidentSeverityOptions(false).map((o) => o.label)).toEqual(["Note", "Heads-up", "Urgent", "Emergency"]);
    expect(incidentSeverityOptions(true).every((o, i) => o.label.startsWith(["Note", "Heads-up", "Urgent", "Emergency"][i]))).toBe(true);
  });

  it("no severity picker spells its own 'Level N' or low/medium/high labels", () => {
    const findings = SEVERITY_PICKERS.flatMap((file) => {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      return [...source.matchAll(/"Level [1-4][^"]*"|>(?:Low|Medium|High|Critical)</g)].map((m) => `${file}: ${m[0]}`);
    });
    expect(findings).toEqual([]);
  });
});
