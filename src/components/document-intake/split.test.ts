import { describe, expect, it } from "vitest";

import { assignmentFromSegments, checkSplit, removePart } from "./split";

const parts = (n: number) => Array.from({ length: n }, () => ({ title: "" }));

describe("split page assignment", () => {
  it("accepts a plan where every page is in one part or excluded", () => {
    const result = checkSplit(4, [{ title: "Form 1823" }, { title: "" }], { 1: 0, 2: 0, 3: "excluded", 4: 1 });
    expect(result).toEqual({
      ok: true,
      plan: { parts: [{ pages: [1, 2], title: "Form 1823" }, { pages: [4] }], excluded_pages: [3] },
    });
  });

  it("refuses unplaced pages and names them", () => {
    const result = checkSplit(3, parts(2), { 1: 0, 3: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("Not placed: 2");
  });

  it("refuses an empty part", () => {
    const result = checkSplit(2, parts(3), { 1: 0, 2: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("part 3");
  });

  it("refuses one part holding every page (that is not a split)", () => {
    expect(checkSplit(3, parts(1), { 1: 0, 2: 0, 3: 0 }).ok).toBe(false);
    expect(checkSplit(3, parts(1), { 1: 0, 2: 0, 3: "excluded" }).ok).toBe(true);
  });

  it("refuses a single-page document", () => {
    expect(checkSplit(1, parts(1), { 1: 0 }).ok).toBe(false);
  });

  it("starts from the reader's segments without double-placing pages", () => {
    expect(assignmentFromSegments(4, [{ pages: [1, 2] }, { pages: [2, 3, 9] }])).toEqual({ 1: 0, 2: 0, 3: 1 });
  });

  it("removing a part unplaces its pages and shifts later parts down", () => {
    expect(removePart({ 1: 0, 2: 1, 3: 2, 4: "excluded" }, 1)).toEqual({ 1: 0, 3: 1, 4: "excluded" });
  });
});
