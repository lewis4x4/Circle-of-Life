import { describe, expect, it } from "vitest";

import {
  REPUTATION_NO_LISTING_COPY,
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
