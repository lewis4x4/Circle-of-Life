import { describe, expect, it } from "vitest";

import { csvEscapeCell } from "@/lib/csv-export";

// Re-implement the same buildCsv shape from route.ts so we can unit-test the
// exact CSV generation contract without spinning up the Next route runtime.
function buildCsv(
  columns: Array<{ id: string; header: string }>,
  rows: Array<Record<string, string | number | boolean | null>>,
): string {
  const headerLine = columns.map((c) => csvEscapeCell(c.header)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column.id];
        if (value == null) return "";
        return csvEscapeCell(String(value));
      })
      .join(","),
  );
  return [headerLine, ...lines].join("\r\n");
}

describe("v2 exports CSV builder", () => {
  it("builds header + rows in column order", () => {
    const out = buildCsv(
      [
        { id: "name", header: "Facility" },
        { id: "occupancy", header: "Occupancy %" },
      ],
      [
        { name: "Oakridge ALF", occupancy: 92 },
        { name: "Plantation", occupancy: 88 },
      ],
    );
    expect(out).toBe('Facility,Occupancy %\r\nOakridge ALF,92\r\nPlantation,88');
  });

  it("escapes values with commas, quotes, or newlines", () => {
    const out = buildCsv(
      [
        { id: "name", header: "Name" },
        { id: "note", header: "Note" },
      ],
      [{ name: 'Quote "Marks"', note: "Has, comma\nand newline" }],
    );
    expect(out).toContain('"Quote ""Marks"""');
    expect(out).toContain('"Has, comma\nand newline"');
  });

  it("renders null/undefined cells as empty", () => {
    const out = buildCsv(
      [
        { id: "a", header: "A" },
        { id: "b", header: "B" },
      ],
      [{ a: 1, b: null }, { a: null, b: 2 }],
    );
    const lines = out.split("\r\n");
    expect(lines[1]).toBe("1,");
    expect(lines[2]).toBe(",2");
  });

  it("handles 50 rows without truncation", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i + 1}` }));
    const out = buildCsv([{ id: "id", header: "ID" }], rows);
    const lines = out.split("\r\n");
    expect(lines).toHaveLength(51); // header + 50 rows
    expect(lines[50]).toBe("row-50");
  });
});
