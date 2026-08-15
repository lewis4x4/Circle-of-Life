import { describe, expect, it } from "vitest";

import {
  formatReferralsHubOutreachWeek,
  formatReferralsHubReferralSource,
  formatReferralsHubTourScheduledFor,
  REFERRALS_HUB_NO_TOUR_TIME_COPY,
  referralsHubKpiEmptyCopy,
  referralsHubKpiTileValue,
  type ReferralsHubKpiContext,
} from "./referrals-hub-display-copy";

const EM_DASH = "—";

function ctx(partial: Partial<ReferralsHubKpiContext> = {}): ReferralsHubKpiContext {
  return {
    loading: false,
    loadFailed: false,
    ...partial,
  };
}

describe("referralsHubKpiEmptyCopy", () => {
  it("names a failed hub fetch", () => {
    expect(referralsHubKpiEmptyCopy("new_leads", ctx({ loadFailed: true }))).toBe(
      "Referral counts did not load",
    );
    expect(referralsHubKpiEmptyCopy("conversions", ctx({ loadFailed: true }))).toBe(
      "Referral counts did not load",
    );
  });

  it("names per-metric load gaps when counts are absent", () => {
    expect(referralsHubKpiEmptyCopy("new_leads", ctx())).toBe("Lead count not loaded yet");
    expect(referralsHubKpiEmptyCopy("active_pipeline", ctx())).toBe("Pipeline count not loaded yet");
    expect(referralsHubKpiEmptyCopy("needs_attention", ctx())).toBe("Attention count not loaded yet");
    expect(referralsHubKpiEmptyCopy("conversions", ctx())).toBe("Conversion count not loaded yet");
    expect(referralsHubKpiEmptyCopy("in_admissions", ctx())).toBe("Admissions count not loaded yet");
  });
});

describe("referralsHubKpiTileValue", () => {
  it("shows loading copy while bootstrap is in flight", () => {
    expect(referralsHubKpiTileValue("new_leads", 5, ctx({ loading: true }))).toBe("Loading");
    expect(referralsHubKpiTileValue("active_pipeline", null, ctx({ loading: true }))).toBe("Loading");
  });

  it("names a failed hub fetch before per-metric gaps", () => {
    expect(referralsHubKpiTileValue("new_leads", 0, ctx({ loadFailed: true }))).toBe(
      "Referral counts did not load",
    );
    expect(referralsHubKpiTileValue("conversions", null, ctx({ loadFailed: true }))).toBe(
      "Referral counts did not load",
    );
  });

  it("keeps real zeros numeric", () => {
    expect(referralsHubKpiTileValue("new_leads", 0, ctx())).toBe(0);
    expect(referralsHubKpiTileValue("active_pipeline", 0, ctx())).toBe(0);
    expect(referralsHubKpiTileValue("needs_attention", 0, ctx())).toBe(0);
    expect(referralsHubKpiTileValue("conversions", 0, ctx())).toBe(0);
    expect(referralsHubKpiTileValue("in_admissions", 0, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(referralsHubKpiTileValue("new_leads", 12, ctx())).toBe(12);
    expect(referralsHubKpiTileValue("conversions", 3, ctx())).toBe(3);
  });

  it("returns explicit copy when the count is null or undefined", () => {
    expect(referralsHubKpiTileValue("new_leads", null, ctx())).toBe("Lead count not loaded yet");
    expect(referralsHubKpiTileValue("active_pipeline", undefined, ctx())).toBe(
      "Pipeline count not loaded yet",
    );
    expect(referralsHubKpiTileValue("needs_attention", null, ctx())).toBe("Attention count not loaded yet");
    expect(referralsHubKpiTileValue("conversions", null, ctx())).toBe("Conversion count not loaded yet");
    expect(referralsHubKpiTileValue("in_admissions", null, ctx())).toBe("Admissions count not loaded yet");
    expect(referralsHubKpiTileValue("new_leads", null, ctx())).not.toBe(EM_DASH);
    expect(referralsHubKpiTileValue("conversions", null, ctx())).not.toBe(EM_DASH);
  });
});

describe("formatReferralsHubOutreachWeek", () => {
  it("names a missing outreach week instead of an em dash", () => {
    expect(formatReferralsHubOutreachWeek(null)).toBe("No week posted");
    expect(formatReferralsHubOutreachWeek(undefined)).toBe("No week posted");
    expect(formatReferralsHubOutreachWeek("")).toBe("No week posted");
    expect(formatReferralsHubOutreachWeek("   ")).toBe("No week posted");
    expect(formatReferralsHubOutreachWeek(null)).not.toBe(EM_DASH);
  });

  it("returns posted week values unchanged", () => {
    expect(formatReferralsHubOutreachWeek("2026-04-07")).toBe("2026-04-07");
  });
});

describe("formatReferralsHubReferralSource", () => {
  it("names a missing referral source instead of an em dash", () => {
    expect(formatReferralsHubReferralSource(null)).toBe("No source posted");
    expect(formatReferralsHubReferralSource(undefined)).toBe("No source posted");
    expect(formatReferralsHubReferralSource("")).toBe("No source posted");
    expect(formatReferralsHubReferralSource("   ")).toBe("No source posted");
    expect(formatReferralsHubReferralSource(null)).not.toBe(EM_DASH);
  });

  it("returns posted source names unchanged", () => {
    expect(formatReferralsHubReferralSource("Hospital discharge planner")).toBe(
      "Hospital discharge planner",
    );
  });
});

describe("formatReferralsHubTourScheduledFor", () => {
  it("names missing or invalid tour times instead of an em dash", () => {
    expect(formatReferralsHubTourScheduledFor(null)).toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatReferralsHubTourScheduledFor(undefined)).toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatReferralsHubTourScheduledFor("")).toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatReferralsHubTourScheduledFor("   ")).toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatReferralsHubTourScheduledFor("not-a-date")).toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatReferralsHubTourScheduledFor(null)).not.toBe(EM_DASH);
  });

  it("returns a non-empty locale string for a real ISO timestamp", () => {
    const formatted = formatReferralsHubTourScheduledFor("2026-04-09T15:30:00.000Z");
    expect(formatted).toBeTruthy();
    expect(formatted).not.toBe(REFERRALS_HUB_NO_TOUR_TIME_COPY);
    expect(formatted).not.toBe(EM_DASH);
  });
});
