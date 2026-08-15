import { describe, expect, it } from "vitest";

import {
  vendorsHubKpiEmptyCopy,
  vendorsHubKpiTileValue,
  vendorsHubMtdSpendTileValue,
  type VendorsHubKpiContext,
} from "./vendors-hub-display-copy";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const EM_DASH = "—";

function ctx(partial: Partial<VendorsHubKpiContext> = {}): VendorsHubKpiContext {
  return {
    organizationId: ORG_ID,
    loadFailed: false,
    ...partial,
  };
}

describe("vendorsHubKpiEmptyCopy", () => {
  it("names missing organization scope", () => {
    expect(vendorsHubKpiEmptyCopy("vendor_count", ctx({ organizationId: null }))).toBe(
      "Organization not on profile",
    );
  });

  it("names a failed overview fetch", () => {
    expect(vendorsHubKpiEmptyCopy("open_alerts", ctx({ loadFailed: true }))).toBe(
      "Vendor counts did not load",
    );
    expect(vendorsHubKpiEmptyCopy("mtd_spend", ctx({ loadFailed: true }))).toBe(
      "Vendor counts did not load",
    );
  });

  it("names per-metric load gaps when org is set but counts are absent", () => {
    expect(vendorsHubKpiEmptyCopy("vendor_count", ctx())).toBe("Vendor count not loaded yet");
    expect(vendorsHubKpiEmptyCopy("open_alerts", ctx())).toBe("Open alert count not loaded yet");
    expect(vendorsHubKpiEmptyCopy("mtd_spend", ctx())).toBe("MTD spend not loaded yet");
  });
});

describe("vendorsHubKpiTileValue", () => {
  it("keeps real zeros numeric", () => {
    expect(vendorsHubKpiTileValue("vendor_count", 0, ctx())).toBe(0);
    expect(vendorsHubKpiTileValue("open_alerts", 0, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(vendorsHubKpiTileValue("vendor_count", 8, ctx())).toBe(8);
    expect(vendorsHubKpiTileValue("open_alerts", 3, ctx())).toBe(3);
  });

  it("returns explicit copy when the count is null instead of an em dash", () => {
    expect(vendorsHubKpiTileValue("vendor_count", null, ctx())).toBe("Vendor count not loaded yet");
    expect(vendorsHubKpiTileValue("open_alerts", null, ctx({ organizationId: null }))).toBe(
      "Organization not on profile",
    );
    expect(vendorsHubKpiTileValue("open_alerts", null, ctx({ loadFailed: true }))).toBe(
      "Vendor counts did not load",
    );
    expect(vendorsHubKpiTileValue("vendor_count", null, ctx())).not.toBe(EM_DASH);
    expect(vendorsHubKpiTileValue("open_alerts", null, ctx())).not.toBe(EM_DASH);
  });
});

describe("vendorsHubMtdSpendTileValue", () => {
  it("formats loaded spend including real zero", () => {
    expect(vendorsHubMtdSpendTileValue(0, ctx())).toBe("$0.00");
    expect(vendorsHubMtdSpendTileValue(125_00, ctx())).toBe("$125.00");
  });

  it("returns explicit copy when spend is null instead of an em dash", () => {
    expect(vendorsHubMtdSpendTileValue(null, ctx())).toBe("MTD spend not loaded yet");
    expect(vendorsHubMtdSpendTileValue(null, ctx({ loadFailed: true }))).toBe(
      "Vendor counts did not load",
    );
    expect(vendorsHubMtdSpendTileValue(null, ctx())).not.toBe(EM_DASH);
  });
});
