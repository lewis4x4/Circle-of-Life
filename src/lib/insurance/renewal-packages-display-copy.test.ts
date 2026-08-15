import { describe, expect, it } from "vitest";

import { FORMAT_USD_NO_AMOUNT_POSTED_COPY } from "@/lib/insurance/format-money";

import {
  formatRenewalPackageActiveResidents,
  formatRenewalPackageActiveStaff,
  formatRenewalPackageIncidentsInPeriod,
  formatRenewalPackageInvoiceTotal,
  formatRenewalPackagePayloadVersion,
  formatRenewalPackagePolicyNumber,
  RENEWAL_PACKAGE_NO_INCIDENT_COUNT_COPY,
  RENEWAL_PACKAGE_NO_INVOICE_TOTAL_COPY,
  RENEWAL_PACKAGE_NO_PAYLOAD_VERSION_COPY,
  RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY,
  RENEWAL_PACKAGE_NO_RESIDENT_COUNT_COPY,
  RENEWAL_PACKAGE_NO_STAFF_COUNT_COPY,
} from "./renewal-packages-display-copy";

describe("formatRenewalPackagePolicyNumber", () => {
  it("returns explicit copy when policy number is missing or blank", () => {
    expect(formatRenewalPackagePolicyNumber(null)).toBe(RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY);
    expect(formatRenewalPackagePolicyNumber(undefined)).toBe(RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY);
    expect(formatRenewalPackagePolicyNumber("")).toBe(RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY);
    expect(formatRenewalPackagePolicyNumber("   ")).toBe(RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY);
  });

  it("returns the posted policy number unchanged", () => {
    expect(formatRenewalPackagePolicyNumber("POL-1001")).toBe("POL-1001");
  });
});

describe("formatRenewalPackagePayloadVersion", () => {
  it("returns explicit copy when version is missing", () => {
    expect(formatRenewalPackagePayloadVersion(null)).toBe(RENEWAL_PACKAGE_NO_PAYLOAD_VERSION_COPY);
    expect(formatRenewalPackagePayloadVersion(undefined)).toBe(RENEWAL_PACKAGE_NO_PAYLOAD_VERSION_COPY);
  });

  it("returns the real payload version number", () => {
    expect(formatRenewalPackagePayloadVersion(1)).toBe(1);
  });
});

describe("formatRenewalPackageActiveResidents", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatRenewalPackageActiveResidents(null)).toBe(RENEWAL_PACKAGE_NO_RESIDENT_COUNT_COPY);
    expect(formatRenewalPackageActiveResidents(undefined)).toBe(RENEWAL_PACKAGE_NO_RESIDENT_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatRenewalPackageActiveResidents(0)).toBe(0);
  });

  it("returns posted counts unchanged", () => {
    expect(formatRenewalPackageActiveResidents(42)).toBe(42);
  });
});

describe("formatRenewalPackageIncidentsInPeriod", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatRenewalPackageIncidentsInPeriod(null)).toBe(RENEWAL_PACKAGE_NO_INCIDENT_COUNT_COPY);
    expect(formatRenewalPackageIncidentsInPeriod(undefined)).toBe(RENEWAL_PACKAGE_NO_INCIDENT_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatRenewalPackageIncidentsInPeriod(0)).toBe(0);
  });
});

describe("formatRenewalPackageActiveStaff", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatRenewalPackageActiveStaff(null)).toBe(RENEWAL_PACKAGE_NO_STAFF_COUNT_COPY);
    expect(formatRenewalPackageActiveStaff(undefined)).toBe(RENEWAL_PACKAGE_NO_STAFF_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatRenewalPackageActiveStaff(0)).toBe(0);
  });
});

describe("formatRenewalPackageInvoiceTotal", () => {
  it("returns explicit copy when metrics object is missing", () => {
    expect(formatRenewalPackageInvoiceTotal(null)).toBe(RENEWAL_PACKAGE_NO_INVOICE_TOTAL_COPY);
    expect(formatRenewalPackageInvoiceTotal(undefined)).toBe(RENEWAL_PACKAGE_NO_INVOICE_TOTAL_COPY);
  });

  it("formats invoice cents when metrics are present", () => {
    expect(formatRenewalPackageInvoiceTotal({ invoice_total_cents: 0 })).toBe("$0.00");
    expect(formatRenewalPackageInvoiceTotal({ invoice_total_cents: 125000 })).toBe("$1,250.00");
  });

  it("uses amount missing copy when cents are unset on metrics", () => {
    expect(
      formatRenewalPackageInvoiceTotal({ invoice_total_cents: null as unknown as number }),
    ).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
  });
});
