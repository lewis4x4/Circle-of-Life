import { describe, expect, it } from "vitest";

import {
  VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY,
  VENDOR_CONTRACT_NO_VENDOR_NAME_COPY,
  formatVendorContractExpirationDate,
  formatVendorContractVendorName,
} from "./contracts-display-copy";

const EM_DASH = "—";

describe("formatVendorContractVendorName", () => {
  it("names a missing vendor instead of an em dash", () => {
    expect(formatVendorContractVendorName(null)).toBe(VENDOR_CONTRACT_NO_VENDOR_NAME_COPY);
    expect(formatVendorContractVendorName(undefined)).toBe(VENDOR_CONTRACT_NO_VENDOR_NAME_COPY);
    expect(formatVendorContractVendorName("")).toBe(VENDOR_CONTRACT_NO_VENDOR_NAME_COPY);
    expect(formatVendorContractVendorName("   ")).toBe(VENDOR_CONTRACT_NO_VENDOR_NAME_COPY);
    expect(formatVendorContractVendorName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted vendor name trimmed", () => {
    expect(formatVendorContractVendorName("Vendor A")).toBe("Vendor A");
    expect(formatVendorContractVendorName("  Vendor A  ")).toBe("Vendor A");
  });
});

describe("formatVendorContractExpirationDate", () => {
  it("names a missing expiration date instead of an em dash", () => {
    expect(formatVendorContractExpirationDate(null)).toBe(VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY);
    expect(formatVendorContractExpirationDate(undefined)).toBe(VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY);
    expect(formatVendorContractExpirationDate("")).toBe(VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY);
    expect(formatVendorContractExpirationDate("   ")).toBe(VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY);
    expect(formatVendorContractExpirationDate(null)).not.toBe(EM_DASH);
  });

  it("returns a posted expiration date trimmed", () => {
    expect(formatVendorContractExpirationDate("2026-12-31")).toBe("2026-12-31");
    expect(formatVendorContractExpirationDate("  2026-12-31  ")).toBe("2026-12-31");
  });
});
