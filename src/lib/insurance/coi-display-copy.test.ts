import { describe, expect, it } from "vitest";

import {
  formatInsuranceCoiExpirationDate,
  INSURANCE_COI_NO_EXPIRATION_DATE_COPY,
} from "./coi-display-copy";

describe("formatInsuranceCoiExpirationDate", () => {
  it("returns explicit copy when expiration date is missing or blank", () => {
    expect(formatInsuranceCoiExpirationDate(null)).toBe(INSURANCE_COI_NO_EXPIRATION_DATE_COPY);
    expect(formatInsuranceCoiExpirationDate(undefined)).toBe(INSURANCE_COI_NO_EXPIRATION_DATE_COPY);
    expect(formatInsuranceCoiExpirationDate("")).toBe(INSURANCE_COI_NO_EXPIRATION_DATE_COPY);
    expect(formatInsuranceCoiExpirationDate("   ")).toBe(INSURANCE_COI_NO_EXPIRATION_DATE_COPY);
    expect(formatInsuranceCoiExpirationDate("not-a-date")).toBe(INSURANCE_COI_NO_EXPIRATION_DATE_COPY);
  });

  it("formats a date-only ISO value", () => {
    expect(formatInsuranceCoiExpirationDate("2024-06-01")).toBe("Jun 1, 2024");
  });

  it("formats a full ISO timestamp", () => {
    expect(formatInsuranceCoiExpirationDate("2024-06-01T08:30:00.000Z")).toBe("Jun 1, 2024");
  });
});
