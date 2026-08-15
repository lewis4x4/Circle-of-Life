import { describe, expect, it } from "vitest";

import { workersCompReturnToWorkDateCopy } from "./workers-comp-copy";

describe("workersCompReturnToWorkDateCopy", () => {
  it("returns the posted date unchanged", () => {
    expect(workersCompReturnToWorkDateCopy("2026-03-15")).toBe("2026-03-15");
  });

  it("names a missing return-to-work date", () => {
    expect(workersCompReturnToWorkDateCopy(null)).toBe("No return-to-work date posted");
    expect(workersCompReturnToWorkDateCopy(undefined)).toBe("No return-to-work date posted");
  });
});
