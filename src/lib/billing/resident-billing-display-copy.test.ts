import { describe, expect, it } from "vitest";

import {
  RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY,
  RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY,
  formatResidentBillingMedicaidProviderFromCatalog,
  formatResidentBillingMedicaidProviderName,
  formatResidentBillingMedicaidRateUnitLabel,
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
