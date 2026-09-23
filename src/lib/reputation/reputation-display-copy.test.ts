import { describe, expect, it } from "vitest";

import {
  REPUTATION_NO_LISTING_COPY,
  formatReputationHubCardSubtitle,
  reputationDraftQueueEmptyKind,
  reputationHubCountState,
  formatReputationListingLabel,
} from "./reputation-display-copy";

const EM_DASH = "—";
const POSTED_LISTING = "Posted Listing";

describe("formatReputationListingLabel", () => {
  it("names the gap when listing label is missing", () => {
    expect(formatReputationListingLabel(null)).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel(undefined)).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel(null)).not.toBe(EM_DASH);
  });

  it("names the gap when listing label is blank", () => {
    expect(formatReputationListingLabel("")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("   ")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("")).not.toBe(EM_DASH);
  });

  it("names the gap when listing label is an em dash", () => {
    expect(formatReputationListingLabel(EM_DASH)).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel(`  ${EM_DASH}  `)).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel(EM_DASH)).not.toBe(EM_DASH);
  });

  it("replaces legacy Unknown and Unknown Listing copy with a named gap", () => {
    expect(formatReputationListingLabel("Unknown")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("  Unknown  ")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("Unknown Listing")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("  Unknown Listing  ")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("Unknown Listing")).not.toBe("Unknown Listing");
  });

  it("replaces legacy Unnamed and Unnamed listing copy with a named gap", () => {
    expect(formatReputationListingLabel("Unnamed")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("Unnamed listing")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("  Unnamed listing  ")).toBe(REPUTATION_NO_LISTING_COPY);
    expect(formatReputationListingLabel("Unnamed listing")).not.toBe("Unnamed listing");
  });

  it("keeps posted listing label trimmed as-is", () => {
    expect(formatReputationListingLabel(POSTED_LISTING)).toBe(POSTED_LISTING);
    expect(formatReputationListingLabel(`  ${POSTED_LISTING}  `)).toBe(POSTED_LISTING);
  });
});

describe("formatReputationHubCardSubtitle", () => {
  it("names the facility when posted", () => {
    expect(formatReputationHubCardSubtitle("Anon Facility A")).toBe(
      "Connected listings and reply workflow for Anon Facility A.",
    );
  });

  it("names the gap without selected-facility copy when missing", () => {
    expect(formatReputationHubCardSubtitle(null)).toBe(
      "Connected listings and reply workflow for this facility.",
    );
    expect(formatReputationHubCardSubtitle("   ")).toBe(
      "Connected listings and reply workflow for this facility.",
    );
    expect(formatReputationHubCardSubtitle(null)).not.toContain("selected facility");
  });
});

describe("reputation hub honest counts (COL-649)", () => {
  it("shows Select a facility, not 0, with no facility", () => {
    expect(reputationHubCountState({ facilityReady: false, loading: false, error: null, count: 0 })).toEqual({
      status: "not_configured",
      reason: "Select a facility",
    });
  });

  it("shows Unavailable after a failed read and keeps a loaded zero", () => {
    expect(reputationHubCountState({ facilityReady: true, loading: false, error: new Error("x"), count: 0 }).status).toBe(
      "unavailable",
    );
    expect(reputationHubCountState({ facilityReady: true, loading: false, error: null, count: 0 })).toEqual({
      status: "value",
      value: 0,
    });
  });

  it("does not call a facility with no listings Inbox Zero", () => {
    const base = { facilityReady: true, loading: false, error: null, draftCount: 0 };
    expect(reputationDraftQueueEmptyKind({ ...base, accountCount: 0 })).toBe("no_listings");
    expect(reputationDraftQueueEmptyKind({ ...base, accountCount: 2 })).toBe("clear");
    expect(reputationDraftQueueEmptyKind({ ...base, accountCount: 2, error: new Error("x") })).toBeNull();
    expect(reputationDraftQueueEmptyKind({ ...base, accountCount: 2, facilityReady: false })).toBeNull();
    expect(reputationDraftQueueEmptyKind({ ...base, accountCount: 2, draftCount: 1 })).toBeNull();
  });
});
