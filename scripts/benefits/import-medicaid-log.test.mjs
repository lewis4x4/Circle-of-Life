import { describe, expect, it } from "vitest";

import { importKey, matchRow, normalize, parseCsv } from "./import-medicaid-log.mjs";

const residents = [
  { id: "r1", first_name: "Joe", last_name: "Synthetic", preferred_name: null, facility_name: "Homewood Lodge, ALF" },
  { id: "r2", first_name: "Anna", last_name: "Example", preferred_name: "Annie", facility_name: "Homewood Lodge, ALF" },
  { id: "r3", first_name: "Anna", last_name: "Example", preferred_name: null, facility_name: "Oakridge ALF" },
];
const row = (over) => ({ facility_tab: "Homewood", facility_name: "Homewood Lodge, ALF", log_name: "x", first: "", last: "", ...over });

describe("Medicaid Log matching", () => {
  it("normalizes punctuation, case and accents", () => {
    expect(normalize("  O'Brien-Smith, José ")).toBe("o brien smith jose");
  });
  it("matches exactly within the same facility only, and by preferred name", () => {
    expect(matchRow(row({ first: "Joe", last: "Synthetic" }), residents)).toMatchObject({ confidence: "exact", resident: { id: "r1" } });
    expect(matchRow(row({ first: "Annie", last: "Example" }), residents)).toMatchObject({ confidence: "exact", resident: { id: "r2" } });
  });
  it("offers a likely match by last name and first initial, never guesses otherwise", () => {
    expect(matchRow(row({ first: "Joseph", last: "Synthetic" }), residents)).toMatchObject({ confidence: "likely", resident: { id: "r1" } });
    expect(matchRow(row({ first: "Zed", last: "Nobody" }), residents).confidence).toBe("none");
  });
  it("reports facilities that have no residents in Haven yet", () => {
    expect(matchRow(row({ facility_tab: "Plantation", facility_name: "The Plantation on Summers", first: "A", last: "B" }), residents).confidence).toBe("facility_not_in_haven");
  });
  it("gives each log row a stable import key", () => {
    expect(importKey(row({ log_name: "Thompson, Joseph" }))).toBe("medicaid-log:Homewood:thompson joseph");
    expect(importKey(row({ log_name: "A B", completed: true }))).toBe("medicaid-log:Homewood:completed:a b");
  });
  it("reads the reviewed mapping CSV, including quoted commas", () => {
    expect(parseCsv('import_key,log_name,decision\nk1,"Doe, Jane",import\n\n')).toEqual([{ import_key: "k1", log_name: "Doe, Jane", decision: "import" }]);
  });
});
