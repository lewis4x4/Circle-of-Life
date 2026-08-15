import { describe, expect, it } from "vitest";

import {
  CONCESSIONS_NO_DATE_POSTED_COPY,
  formatConcessionsDateDisplay,
} from "./concessions-display-copy";

const EM_DASH = "—";

describe("formatConcessionsDateDisplay", () => {
  it("names the gap when no date is posted", () => {
    expect(formatConcessionsDateDisplay(null)).toBe(CONCESSIONS_NO_DATE_POSTED_COPY);
    expect(formatConcessionsDateDisplay(undefined)).toBe(CONCESSIONS_NO_DATE_POSTED_COPY);
    expect(formatConcessionsDateDisplay(null)).not.toBe(EM_DASH);
  });

  it("names the gap when the date string is blank", () => {
    expect(formatConcessionsDateDisplay("")).toBe(CONCESSIONS_NO_DATE_POSTED_COPY);
    expect(formatConcessionsDateDisplay("   ")).toBe(CONCESSIONS_NO_DATE_POSTED_COPY);
    expect(formatConcessionsDateDisplay("—")).toBe(CONCESSIONS_NO_DATE_POSTED_COPY);
  });

  it("formats a posted ISO date with noon pinning", () => {
    const formatted = formatConcessionsDateDisplay("2026-03-15");
    expect(formatted).toContain("Mar");
    expect(formatted).toContain("15");
    expect(formatted).toContain("2026");
  });

  it("returns invalid non-blank strings as-is", () => {
    expect(formatConcessionsDateDisplay("not-a-date")).toBe("not-a-date");
    expect(formatConcessionsDateDisplay("2026-13-40")).toBe("2026-13-40");
  });
});
