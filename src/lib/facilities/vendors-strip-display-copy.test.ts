import { describe, expect, it } from "vitest";

import {
  VENDORS_STRIP_NO_COI_COUNT_COPY,
  VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY,
  formatVendorsStripCoiCurrentDisplay,
  formatVendorsStripContractsExpiringDisplay,
  vendorsStripCoiCurrentIsMissing,
  vendorsStripContractsExpiringIsMissing,
} from "./vendors-strip-display-copy";

const EM_DASH = "—";

describe("formatVendorsStripCoiCurrentDisplay", () => {
  it("names a missing COI count instead of an em dash", () => {
    expect(formatVendorsStripCoiCurrentDisplay(null)).toBe(VENDORS_STRIP_NO_COI_COUNT_COPY);
    expect(formatVendorsStripCoiCurrentDisplay(undefined)).toBe(VENDORS_STRIP_NO_COI_COUNT_COPY);
    expect(formatVendorsStripCoiCurrentDisplay(Number.NaN)).toBe(VENDORS_STRIP_NO_COI_COUNT_COPY);
    expect(formatVendorsStripCoiCurrentDisplay(null)).not.toBe(EM_DASH);
  });

  it("keeps a posted zero numeric", () => {
    expect(formatVendorsStripCoiCurrentDisplay(0)).toBe("0");
    expect(formatVendorsStripCoiCurrentDisplay(0)).not.toBe(VENDORS_STRIP_NO_COI_COUNT_COPY);
    expect(formatVendorsStripCoiCurrentDisplay(0)).not.toBe(EM_DASH);
  });

  it("shows a posted positive count", () => {
    expect(formatVendorsStripCoiCurrentDisplay(4)).toBe("4");
  });
});

describe("formatVendorsStripContractsExpiringDisplay", () => {
  it("names a missing expiring-contracts count instead of an em dash", () => {
    expect(formatVendorsStripContractsExpiringDisplay(null)).toBe(
      VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY,
    );
    expect(formatVendorsStripContractsExpiringDisplay(undefined)).toBe(
      VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY,
    );
    expect(formatVendorsStripContractsExpiringDisplay(Number.NaN)).toBe(
      VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY,
    );
    expect(formatVendorsStripContractsExpiringDisplay(null)).not.toBe(EM_DASH);
  });

  it("keeps a posted zero numeric", () => {
    expect(formatVendorsStripContractsExpiringDisplay(0)).toBe("0");
    expect(formatVendorsStripContractsExpiringDisplay(0)).not.toBe(
      VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY,
    );
    expect(formatVendorsStripContractsExpiringDisplay(0)).not.toBe(EM_DASH);
  });

  it("shows a posted positive count", () => {
    expect(formatVendorsStripContractsExpiringDisplay(2)).toBe("2");
  });
});

describe("vendorsStripCoiCurrentIsMissing", () => {
  it("flags nullish counts as missing", () => {
    expect(vendorsStripCoiCurrentIsMissing(null)).toBe(true);
    expect(vendorsStripCoiCurrentIsMissing(undefined)).toBe(true);
  });

  it("does not flag a posted count as missing", () => {
    expect(vendorsStripCoiCurrentIsMissing(0)).toBe(false);
    expect(vendorsStripCoiCurrentIsMissing(3)).toBe(false);
  });
});

describe("vendorsStripContractsExpiringIsMissing", () => {
  it("flags nullish counts as missing", () => {
    expect(vendorsStripContractsExpiringIsMissing(null)).toBe(true);
    expect(vendorsStripContractsExpiringIsMissing(undefined)).toBe(true);
  });

  it("does not flag a posted count as missing", () => {
    expect(vendorsStripContractsExpiringIsMissing(0)).toBe(false);
    expect(vendorsStripContractsExpiringIsMissing(5)).toBe(false);
  });
});
