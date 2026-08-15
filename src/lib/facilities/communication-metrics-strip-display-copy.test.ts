import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_STRIP_LOADING_LAST_CHANGE_COPY,
  COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY,
  COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY,
  COMMUNICATION_STRIP_NO_LAST_FAMILY_NOTIFICATION_COPY,
  COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY,
  COMMUNICATION_STRIP_NO_OPEN_VISITOR_SESSIONS_COPY,
  communicationStripListingHealthIsResolved,
  formatCommunicationStripLastChange,
  formatCommunicationStripLastFamilyNotification,
  formatCommunicationStripOpenVisitorSessions,
  resolveCommunicationStripOnlineListingHealth,
} from "./communication-metrics-strip-display-copy";

const EM_DASH = "—";

describe("formatCommunicationStripLastFamilyNotification", () => {
  it("returns named loading copy", () => {
    expect(formatCommunicationStripLastFamilyNotification(true)).toBe(
      "Loading last family notification…",
    );
    expect(formatCommunicationStripLastFamilyNotification(true)).not.toBe(EM_DASH);
  });

  it("names the notification telemetry gap when loaded", () => {
    expect(formatCommunicationStripLastFamilyNotification(false)).toBe(
      COMMUNICATION_STRIP_NO_LAST_FAMILY_NOTIFICATION_COPY,
    );
    expect(formatCommunicationStripLastFamilyNotification(false)).not.toBe(EM_DASH);
  });
});

describe("formatCommunicationStripOpenVisitorSessions", () => {
  it("returns named loading copy", () => {
    expect(formatCommunicationStripOpenVisitorSessions(true)).toBe(
      "Loading open visitor sessions…",
    );
    expect(formatCommunicationStripOpenVisitorSessions(true)).not.toBe(EM_DASH);
  });

  it("names the visitor session telemetry gap when loaded", () => {
    expect(formatCommunicationStripOpenVisitorSessions(false)).toBe(
      COMMUNICATION_STRIP_NO_OPEN_VISITOR_SESSIONS_COPY,
    );
    expect(formatCommunicationStripOpenVisitorSessions(false)).not.toBe(EM_DASH);
  });
});

describe("formatCommunicationStripLastChange", () => {
  it("returns named loading copy", () => {
    expect(formatCommunicationStripLastChange("2026-01-15T12:00:00.000Z", true)).toBe(
      COMMUNICATION_STRIP_LOADING_LAST_CHANGE_COPY,
    );
    expect(formatCommunicationStripLastChange(null, true)).not.toBe(EM_DASH);
  });

  it("names a missing timestamp instead of an em dash", () => {
    expect(formatCommunicationStripLastChange(null, false)).toBe(
      COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY,
    );
    expect(formatCommunicationStripLastChange(undefined, false)).toBe(
      COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY,
    );
    expect(formatCommunicationStripLastChange("not-a-date", false)).toBe(
      COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY,
    );
    expect(formatCommunicationStripLastChange(null, false)).not.toBe(EM_DASH);
  });

  it("formats a posted timestamp in America/New_York", () => {
    const formatted = formatCommunicationStripLastChange("2026-01-15T17:30:00.000Z", false);
    expect(formatted).not.toBe(COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY);
    expect(formatted).toMatch(/Jan/);
    expect(formatted).toMatch(/2026/);
  });
});

describe("resolveCommunicationStripOnlineListingHealth", () => {
  it("returns named loading copy while the profile loads", () => {
    const health = resolveCommunicationStripOnlineListingHealth(null, true);
    expect(health.value).toBe(COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY);
    expect(health.value).not.toBe(EM_DASH);
    expect(health.sub).toBe("Loading profile");
  });

  it("names a missing profile gap when loaded without settings", () => {
    const health = resolveCommunicationStripOnlineListingHealth(null, false);
    expect(health.value).toBe(COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY);
    expect(health.value).not.toBe(EM_DASH);
  });

  it("resolves linked listings from posted URLs", () => {
    const health = resolveCommunicationStripOnlineListingHealth(
      {
        google_business_profile_url: "https://example.com/google",
        yelp_listing_url: "https://example.com/yelp",
      },
      false,
    );
    expect(health.value).toBe("Linked");
    expect(health.sub).toBe("Google + Yelp on file");
  });

  it("never returns a silent em dash", () => {
    const cases = [
      resolveCommunicationStripOnlineListingHealth(null, true),
      resolveCommunicationStripOnlineListingHealth(null, false),
      resolveCommunicationStripOnlineListingHealth({}, false),
      resolveCommunicationStripOnlineListingHealth(
        { google_business_profile_url: "https://example.com/google" },
        false,
      ),
    ];
    for (const health of cases) {
      expect(health.value).not.toBe(EM_DASH);
    }
  });
});

describe("communicationStripListingHealthIsResolved", () => {
  it("flags loading and missing-profile copy as unresolved", () => {
    expect(
      communicationStripListingHealthIsResolved({
        value: COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY,
        sub: "Loading profile",
      }),
    ).toBe(false);
    expect(
      communicationStripListingHealthIsResolved({
        value: COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY,
        sub: "No communication profile on file",
      }),
    ).toBe(false);
  });

  it("flags linked and review-needed statuses as resolved", () => {
    expect(
      communicationStripListingHealthIsResolved({ value: "Linked", sub: "Google + Yelp on file" }),
    ).toBe(true);
    expect(
      communicationStripListingHealthIsResolved({
        value: "Review needed",
        sub: "No listing URLs on file",
        warn: true,
      }),
    ).toBe(true);
  });
});
