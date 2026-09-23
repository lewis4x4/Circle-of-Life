import { describe, expect, it } from "vitest";

import {
  RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY,
  RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY,
  formatResidentBillingMedicaidProviderCurrent,
  formatResidentBillingMedicaidProviderFromCatalog,
  formatResidentBillingMedicaidProviderName,
  formatResidentBillingMedicaidRateUnitLabel,
  residentBillingMedicaidSplitLine,
} from "./resident-billing-display-copy";

const CATALOG = [
  { id: "prov-1", provider_name: "  Sunshine Health  " },
  { id: "prov-2", provider_name: "Humana" },
] as const;

describe("formatResidentBillingMedicaidProviderName", () => {
  it("returns a posted provider name trimmed", () => {
    expect(formatResidentBillingMedicaidProviderName("  Sunshine Health  ")).toBe("Sunshine Health");
    expect(formatResidentBillingMedicaidProviderName("Humana")).toBe("Humana");
  });

  it("names the gap when no provider name is posted", () => {
    expect(formatResidentBillingMedicaidProviderName(null)).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
    expect(formatResidentBillingMedicaidProviderName(undefined)).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
    expect(formatResidentBillingMedicaidProviderName("")).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
    expect(formatResidentBillingMedicaidProviderName("   ")).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
    expect(formatResidentBillingMedicaidProviderName("—")).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
  });
});

describe("formatResidentBillingMedicaidProviderFromCatalog", () => {
  it("resolves a posted catalog provider by id", () => {
    expect(formatResidentBillingMedicaidProviderFromCatalog("prov-1", [...CATALOG])).toBe("Sunshine Health");
  });

  it("names the gap when provider id is missing or not in catalog", () => {
    expect(formatResidentBillingMedicaidProviderFromCatalog(null, [...CATALOG])).toBe(
      RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY,
    );
    expect(formatResidentBillingMedicaidProviderFromCatalog("missing-id", [...CATALOG])).toBe(
      RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY,
    );
  });
});

describe("formatResidentBillingMedicaidRateUnitLabel", () => {
  it("labels posted Medicaid rate units", () => {
    expect(formatResidentBillingMedicaidRateUnitLabel("monthly")).toBe("Monthly");
    expect(formatResidentBillingMedicaidRateUnitLabel("daily")).toBe("Daily");
    expect(formatResidentBillingMedicaidRateUnitLabel("weekly")).toBe("Weekly");
    expect(formatResidentBillingMedicaidRateUnitLabel("per_billable_day")).toBe("Per Billable Day");
  });

  it("names the gap when no rate unit is posted", () => {
    expect(formatResidentBillingMedicaidRateUnitLabel(null)).toBe(RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY);
    expect(formatResidentBillingMedicaidRateUnitLabel(undefined)).toBe(RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY);
    expect(formatResidentBillingMedicaidRateUnitLabel("")).toBe(RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY);
    expect(formatResidentBillingMedicaidRateUnitLabel("   ")).toBe(RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY);
    expect(formatResidentBillingMedicaidRateUnitLabel("—")).toBe(RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY);
  });
});

describe("Medicaid payer card lines (COL-667)", () => {
  it("names an unlinked insurer instead of saying no provider under its name", () => {
    expect(formatResidentBillingMedicaidProviderCurrent(null, [...CATALOG], "UnitedHealthcare")).toBe(
      "UnitedHealthcare is on the payer record but not linked to a facility Medicaid provider",
    );
    expect(formatResidentBillingMedicaidProviderCurrent("prov-2", [...CATALOG], "UnitedHealthcare")).toBe("Humana");
    expect(formatResidentBillingMedicaidProviderCurrent(null, [...CATALOG], "  ")).toBe(RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY);
  });

  it("explains why a Homewood Medicaid draft is less than the resident's terms", () => {
    // Terms $2,437.00 = Medicaid $1,600.00 + resident share $837.00; the draft is $1,600.00 (COL-678).
    expect(residentBillingMedicaidSplitLine(160_000, 83_700)).toBe(
      "Medicaid pays $1,600.00 · resident share $837.00 a month. From October 2026 the resident share is billed on its own invoice to the resident or responsible party; earlier invoices carry the Medicaid portion only.",
    );
    expect(residentBillingMedicaidSplitLine(160_000, 0)).toBe("Medicaid pays $1,600.00 · resident share $0.00 a month.");
    expect(residentBillingMedicaidSplitLine(null, null)).toBeNull();
  });
});
