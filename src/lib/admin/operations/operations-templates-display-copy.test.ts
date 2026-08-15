import { describe, expect, it } from "vitest";

import {
  OPERATIONS_TEMPLATES_NO_ASSET_COPY,
  OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY,
  OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY,
  OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY,
  OPERATIONS_TEMPLATES_NO_VENDOR_COPY,
  formatOperationsTemplateAsset,
  formatOperationsTemplateAutoCompleteHours,
  formatOperationsTemplateCompliance,
  formatOperationsTemplateEstimatedMinutes,
  formatOperationsTemplateVendor,
} from "./operations-templates-display-copy";

const EM_DASH = "—";

describe("formatOperationsTemplateEstimatedMinutes", () => {
  it("names missing minutes instead of an em dash", () => {
    expect(formatOperationsTemplateEstimatedMinutes(null)).toBe(OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY);
    expect(formatOperationsTemplateEstimatedMinutes(undefined)).toBe(OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY);
    expect(formatOperationsTemplateEstimatedMinutes(Number.NaN)).toBe(OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY);
    expect(formatOperationsTemplateEstimatedMinutes(null)).not.toBe(EM_DASH);
  });

  it("keeps posted zero numeric", () => {
    expect(formatOperationsTemplateEstimatedMinutes(0)).toBe("0 min");
  });

  it("returns posted minutes", () => {
    expect(formatOperationsTemplateEstimatedMinutes(30)).toBe("30 min");
    expect(formatOperationsTemplateEstimatedMinutes(15)).toBe("15 min");
  });
});

describe("formatOperationsTemplateCompliance", () => {
  it("names missing, blank, and em dash compliance instead of a silent dash", () => {
    expect(formatOperationsTemplateCompliance(null)).toBe(OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY);
    expect(formatOperationsTemplateCompliance("")).toBe(OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY);
    expect(formatOperationsTemplateCompliance("   ")).toBe(OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY);
    expect(formatOperationsTemplateCompliance(EM_DASH)).toBe(OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY);
    expect(formatOperationsTemplateCompliance(`  ${EM_DASH}  `)).toBe(OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY);
    expect(formatOperationsTemplateCompliance(null)).not.toBe(EM_DASH);
  });

  it("returns trimmed posted compliance", () => {
    expect(formatOperationsTemplateCompliance("AHCA 59A-36.007")).toBe("AHCA 59A-36.007");
    expect(formatOperationsTemplateCompliance("  FAC 59A-36  ")).toBe("FAC 59A-36");
  });
});

describe("formatOperationsTemplateAsset", () => {
  it("names missing, blank, and em dash asset instead of a silent dash", () => {
    expect(formatOperationsTemplateAsset(null)).toBe(OPERATIONS_TEMPLATES_NO_ASSET_COPY);
    expect(formatOperationsTemplateAsset("")).toBe(OPERATIONS_TEMPLATES_NO_ASSET_COPY);
    expect(formatOperationsTemplateAsset("   ")).toBe(OPERATIONS_TEMPLATES_NO_ASSET_COPY);
    expect(formatOperationsTemplateAsset(EM_DASH)).toBe(OPERATIONS_TEMPLATES_NO_ASSET_COPY);
    expect(formatOperationsTemplateAsset(`  ${EM_DASH}  `)).toBe(OPERATIONS_TEMPLATES_NO_ASSET_COPY);
    expect(formatOperationsTemplateAsset(null)).not.toBe(EM_DASH);
  });

  it("returns trimmed posted asset name", () => {
    expect(formatOperationsTemplateAsset("Generator A")).toBe("Generator A");
    expect(formatOperationsTemplateAsset("  HVAC unit 2  ")).toBe("HVAC unit 2");
  });
});

describe("formatOperationsTemplateVendor", () => {
  it("names missing, blank, and em dash vendor instead of a silent dash", () => {
    expect(formatOperationsTemplateVendor(null)).toBe(OPERATIONS_TEMPLATES_NO_VENDOR_COPY);
    expect(formatOperationsTemplateVendor("")).toBe(OPERATIONS_TEMPLATES_NO_VENDOR_COPY);
    expect(formatOperationsTemplateVendor("   ")).toBe(OPERATIONS_TEMPLATES_NO_VENDOR_COPY);
    expect(formatOperationsTemplateVendor(EM_DASH)).toBe(OPERATIONS_TEMPLATES_NO_VENDOR_COPY);
    expect(formatOperationsTemplateVendor(`  ${EM_DASH}  `)).toBe(OPERATIONS_TEMPLATES_NO_VENDOR_COPY);
    expect(formatOperationsTemplateVendor(null)).not.toBe(EM_DASH);
  });

  it("returns trimmed posted vendor name", () => {
    expect(formatOperationsTemplateVendor("ABC Maintenance")).toBe("ABC Maintenance");
    expect(formatOperationsTemplateVendor("  Fire Safety Co  ")).toBe("Fire Safety Co");
  });
});

describe("formatOperationsTemplateAutoCompleteHours", () => {
  it("names missing hours instead of an em dash", () => {
    expect(formatOperationsTemplateAutoCompleteHours(null)).toBe(OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY);
    expect(formatOperationsTemplateAutoCompleteHours(undefined)).toBe(OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY);
    expect(formatOperationsTemplateAutoCompleteHours(Number.NaN)).toBe(OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY);
    expect(formatOperationsTemplateAutoCompleteHours(null)).not.toBe(EM_DASH);
  });

  it("keeps posted zero numeric", () => {
    expect(formatOperationsTemplateAutoCompleteHours(0)).toBe("0h");
  });

  it("returns posted hours", () => {
    expect(formatOperationsTemplateAutoCompleteHours(24)).toBe("24h");
    expect(formatOperationsTemplateAutoCompleteHours(8)).toBe("8h");
  });
});
