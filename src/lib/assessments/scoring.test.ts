import { describe, expect, it } from "vitest";

import { computeNextDueDate } from "./scoring";

describe("computeNextDueDate", () => {
  it("adds 90 days on the Eastern calendar even where a UTC slice would flip", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";

    try {
      expect(computeNextDueDate("2026-01-01", 90)).toBe("2026-04-01");
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });
});
