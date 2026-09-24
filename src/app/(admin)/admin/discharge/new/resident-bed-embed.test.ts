import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// residents and beds are joined by two foreign keys (residents.bed_id and
// beds.current_resident_id), so an unnamed `beds(...)` embed makes PostgREST
// refuse the whole read ("more than one relationship was found"). COL-662.
describe("discharge picker resident query", () => {
  it("names the foreign key for the beds embed", () => {
    const source = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(source).toContain("beds!residents_bed_id_fkey(");
    expect(source).not.toMatch(/[\s,"]beds\(/);
  });
});
