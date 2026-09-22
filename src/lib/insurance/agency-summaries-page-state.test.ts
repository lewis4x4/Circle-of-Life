import { describe, expect, it } from "vitest";

import {
  connectionStateCopy,
  freshnessDisclosure,
  incompleteSummaryDisclosure,
  isAuthorizationFresh,
} from "./agency-summaries-page-state";

const NOW = new Date("2026-09-22T12:00:00Z");

describe("isAuthorizationFresh", () => {
  it("is false when nothing has been confirmed", () => {
    expect(isAuthorizationFresh({ authorization_valid_until: null }, NOW)).toBe(false);
  });

  it("is false once the window has passed", () => {
    expect(isAuthorizationFresh({ authorization_valid_until: "2026-09-22T11:59:59Z" }, NOW)).toBe(false);
  });

  it("is true inside the window", () => {
    expect(isAuthorizationFresh({ authorization_valid_until: "2026-09-23T11:00:00Z" }, NOW)).toBe(true);
  });

  it("is false when the timestamp is unparseable rather than optimistically true", () => {
    expect(isAuthorizationFresh({ authorization_valid_until: "whenever" }, NOW)).toBe(false);
  });
});

describe("incompleteSummaryDisclosure", () => {
  it("says nothing when everything released is shown", () => {
    expect(incompleteSummaryDisclosure({ incomplete_summary_count: 0, summaries: [] as never[] })).toBeNull();
  });

  // The production case: six released, one mapped, five withheld.
  it("names the shortfall and says the records are not missing from the agency", () => {
    const copy = incompleteSummaryDisclosure({
      incomplete_summary_count: 5,
      summaries: [{}] as never[],
    });
    expect(copy).toBe(
      "Showing 1 of 6. 5 records are withheld pending an approved account mapping — they exist at the agency and are not displayed here.",
    );
  });

  it("handles a single withheld record grammatically", () => {
    const copy = incompleteSummaryDisclosure({ incomplete_summary_count: 1, summaries: [{}, {}] as never[] });
    expect(copy).toContain("1 record is withheld");
  });

  it("does not pretend an empty page means the agency has nothing", () => {
    const copy = incompleteSummaryDisclosure({ incomplete_summary_count: 4, summaries: [] as never[] });
    expect(copy).toBe(
      "The agency released 4 records and none can be shown. They are withheld pending an approved account mapping, not missing from the agency.",
    );
  });
});

describe("freshnessDisclosure", () => {
  it("says so plainly when nothing has ever synchronised", () => {
    expect(
      freshnessDisclosure(
        { last_authorization_check_at: null, authorization_valid_until: null, state: "never_synced" },
        NOW,
      ),
    ).toBe("Never synchronised. Nothing here has been confirmed with the agency.");
  });

  it("gives the age in minutes when recent", () => {
    expect(
      freshnessDisclosure(
        {
          last_authorization_check_at: "2026-09-22T11:30:00Z",
          authorization_valid_until: "2026-09-23T11:30:00Z",
          state: "healthy",
        },
        NOW,
      ),
    ).toBe("Last confirmed with the agency 30 minutes ago.");
  });

  it("gives the age in hours across a working day", () => {
    expect(
      freshnessDisclosure(
        {
          last_authorization_check_at: "2026-09-22T04:00:00Z",
          authorization_valid_until: "2026-09-23T04:00:00Z",
          state: "healthy",
        },
        NOW,
      ),
    ).toBe("Last confirmed with the agency 8 hours ago.");
  });

  // The failure that matters: the feed quietly stopped and the page still looks populated.
  it("warns rather than reassures once the freshness window has passed", () => {
    const copy = freshnessDisclosure(
      {
        last_authorization_check_at: "2026-09-20T12:00:00Z",
        authorization_valid_until: "2026-09-21T12:00:00Z",
        state: "healthy",
      },
      NOW,
    );
    expect(copy).toContain("outside the agreed freshness window");
    expect(copy).toContain("Treat as unconfirmed");
  });
});

describe("connectionStateCopy", () => {
  it("reads degraded as an explanation, not an alarm", () => {
    expect(connectionStateCopy("degraded")).toBe("Synchronised, some records withheld");
  });

  it("does not soften a rejected credential", () => {
    expect(connectionStateCopy("credential_rejected")).toBe(
      "The agency rejected Haven's credential. Nothing here is updating.",
    );
  });

  it("names an unknown state instead of guessing", () => {
    expect(connectionStateCopy("something-new")).toBe("State not reported");
    expect(connectionStateCopy(null)).toBe("State not reported");
  });
});

describe("connectionStateCopy — disabled connections", () => {
  it("says disabled rather than letting it read as a fault", () => {
    expect(connectionStateCopy("never_synced", false)).toBe("Disabled — not synchronising");
    expect(connectionStateCopy("healthy", false)).toBe("Disabled — not synchronising");
  });

  it("still reports the real state when enabled", () => {
    expect(connectionStateCopy("healthy", true)).toBe("Synchronised");
  });

  it("defaults to enabled so existing callers are unchanged", () => {
    expect(connectionStateCopy("healthy")).toBe("Synchronised");
  });
});
