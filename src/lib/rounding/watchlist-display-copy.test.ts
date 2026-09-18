import { describe, expect, it } from "vitest";

import {
  BAND_KEYS,
  bandTone,
  formatSignalEvidence,
  buildLedgerCsv,
  isDocumentationSignal,
  LEDGER_CSV_HEADER,
  ledgerCsvFilename,
  nextDispositions,
  ownerLabel,
  residentDisplayName,
  roomLabel,
  signalAgeLabel,
  signalStatusLabel,
  signalStatusTone,
  sourceKindLabel,
  sourceKindTone,
  trendLabel,
  watchlistPageSubtitle,
  resolveWatchlistFacilityScope,
  WATCHLIST_EMPTY_STATE,
} from "./watchlist-display-copy";

describe("Watchlist vocabulary", () => {
  it("renders bands as words and never as numbers", () => {
    for (const band of BAND_KEYS) {
      expect(typeof bandTone(band)).toBe("string");
    }
    expect(bandTone("acute")).toBe("danger");
    expect(bandTone("continued_residency_risk")).toBe("danger");
    expect(bandTone("needs_a_look")).toBe("muted");
    expect(bandTone(null)).toBe("muted");
  });

  it("names a status an operator would recognize and never a raw enum value", () => {
    expect(signalStatusLabel("new")).toBe("Not looked at");
    expect(signalStatusLabel("plan_in_place")).toBe("Plan in place");
    expect(signalStatusLabel("something_else")).toBe("Not recorded");
    expect(signalStatusTone("new")).toBe("warning");
    expect(signalStatusTone("cleared")).toBe("success");
  });

  it("offers only the dispositions the command will accept, forward only", () => {
    expect(nextDispositions("new")).toEqual(["acknowledged", "plan_in_place", "cleared"]);
    expect(nextDispositions("plan_in_place")).toEqual(["cleared"]);
    expect(nextDispositions("cleared")).toEqual([]);
    expect(nextDispositions("not_a_status")).toEqual([]);
  });

  it("separates a documentation signal from a clinical one", () => {
    expect(isDocumentationSignal("data_quality")).toBe(true);
    expect(isDocumentationSignal("clinical")).toBe(false);
    expect(isDocumentationSignal(null)).toBe(false);
    expect(sourceKindLabel("data_quality")).toBe("Documentation");
    expect(sourceKindLabel("clinical")).toBe("Clinical");
    expect(sourceKindTone("data_quality")).not.toBe(sourceKindTone("clinical"));
  });

  it("names a real gap rather than inventing a room, an owner or a trend", () => {
    expect(roomLabel(null)).toBe("No room recorded");
    expect(roomLabel("  ")).toBe("No room recorded");
    expect(roomLabel(" 12B ")).toBe("12B");
    expect(ownerLabel(null)).toBe("Nobody yet");
    expect(trendLabel(null)).toBe("Not enough history yet");
    expect(trendLabel("rising")).toBe("More than the fortnight before");
  });

  it("says how old a signal is in words, and admits when it does not know", () => {
    expect(signalAgeLabel(null)).toBe("Not recorded");
    expect(signalAgeLabel(0)).toBe("Today");
    expect(signalAgeLabel(1)).toBe("Since yesterday");
    expect(signalAgeLabel(9)).toBe("9 days");
  });

  it("prefers a resident's preferred name and never fabricates one", () => {
    expect(
      residentDisplayName({
        resident_first_name: "First",
        resident_last_name: "Last",
        resident_preferred_name: "Preferred",
      }),
    ).toBe("Last, Preferred");
    expect(
      residentDisplayName({
        resident_first_name: "First",
        resident_last_name: "Last",
        resident_preferred_name: null,
      }),
    ).toBe("Last, First");
    expect(
      residentDisplayName({
        resident_first_name: null,
        resident_last_name: null,
        resident_preferred_name: null,
      }),
    ).toBe("Resident not named");
  });

  it("scopes the page to the selected building without inventing its name", () => {
    expect(resolveWatchlistFacilityScope(null, undefined)).toEqual({ kind: "all" });
    expect(resolveWatchlistFacilityScope("id", "  ")).toEqual({ kind: "missing_name" });
    expect(resolveWatchlistFacilityScope("id", " A Building ")).toEqual({
      kind: "named",
      name: "A Building",
    });
    expect(watchlistPageSubtitle({ kind: "named", name: "A Building" })).toContain("A Building");
  });

  it("writes an empty state that says what would populate it", () => {
    expect(WATCHLIST_EMPTY_STATE.title.endsWith(".")).toBe(true);
    expect(WATCHLIST_EMPTY_STATE.body).toContain("rule");
  });
});

describe("the disposition ledger export", () => {
  const row = {
    acted_at: "2026-09-17T14:00:00.000Z",
    resident_name: "Last, First",
    room_number: "12B",
    signal_label: "Two or more falls in a month",
    from_status: "new",
    to_status: "acknowledged",
    acted_by_name: "A Reviewer",
    acted_by_role: "facility_admin",
    note: 'Spoke to the nurse, "raised with family", and moved the bed',
    actor_kind: "user",
  };

  it("matches the column order of the paper log it replaces", () => {
    const csv = buildLedgerCsv([row]);
    const header = csv.split("\n")[0];
    expect(header).toBe(LEDGER_CSV_HEADER.map((cell) => `"${cell}"`).join(","));
  });

  it("survives a disposition line carrying quotes and commas", () => {
    const csv = buildLedgerCsv([row]);
    expect(csv).toContain('"Spoke to the nurse, ""raised with family"", and moved the bed"');
  });

  it("labels a transition the scheduled evaluation made rather than naming a person", () => {
    const csv = buildLedgerCsv([
      { ...row, actor_kind: "system", acted_by_name: null, acted_by_role: null, note: null },
    ]);
    expect(csv).toContain('"Scheduled evaluation"');
    expect(csv).not.toContain("A Reviewer");
  });

  it("renders an opening row as opened rather than as a transition from nothing", () => {
    const csv = buildLedgerCsv([{ ...row, from_status: null }]);
    expect(csv).toContain('"Opened"');
  });

  it("names the export after the building and the day", () => {
    expect(ledgerCsvFilename({ kind: "named", name: "A Building" }, "2026-09-17")).toBe(
      "a-building-disposition-ledger-2026-09-17.csv",
    );
    expect(ledgerCsvFilename({ kind: "all" }, "2026-09-17")).toBe(
      "watchlist-disposition-ledger-2026-09-17.csv",
    );
  });
});

describe("the evidence, in sentences", () => {
  it("turns a fall payload into a line a reviewer would say out loud", () => {
    const lines = formatSignalEvidence("repeat_fall", {
      source: "incidents_and_care_events",
      lookback_days: 30,
      threshold_count: 2,
      event_count: 2,
      event_ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(lines).toContain("2 events recorded in the last 30 days.");
  });

  it("names a baseline of zero as what makes a change a change", () => {
    const lines = formatSignalEvidence("behavior_change", {
      lookback_days: 7,
      baseline_days: 30,
      log_ids: ["a", "b", "c"],
      baseline_count: 0,
    });
    expect(lines).toContain("Recorded on 3 observations in the last 7 days.");
    expect(lines).toContain("Not once in the 30 days before that, which is what makes it a change.");
  });

  it("says how many checks in a row went unrecorded", () => {
    expect(
      formatSignalEvidence("observation_gap", { consecutive_unrecorded_windows: 4 }),
    ).toContain("4 expected checks in a row closed with nothing recorded.");
  });

  it("gives the measured weight change against the threshold it was measured on", () => {
    const lines = formatSignalEvidence("weight_loss", {
      lookback_days: 30,
      drop_percent: 7.5,
      threshold_percent: 5,
    });
    expect(lines[0]).toBe(
      "Weight is down 7.5 percent from the highest reading in the last 30 days, against a threshold of 5 percent.",
    );
  });

  it("puts no row id, table name or payload key on the page", () => {
    const lines = formatSignalEvidence("repeat_fall", {
      source: "incidents_and_care_events",
      lookback_days: 30,
      event_count: 2,
      event_ids: ["11111111-1111-4111-8111-111111111111"],
    });
    const body = lines.join(" ");
    expect(body).not.toContain("11111111");
    expect(body).not.toContain("incidents_and_care_events");
    expect(body).not.toContain("event_ids");
    expect(body).not.toContain("{");
  });

  it("renders nothing rather than a blob when it does not recognize the payload", () => {
    expect(formatSignalEvidence("something_new", { unexpected_key: 4 })).toEqual([]);
    expect(formatSignalEvidence("repeat_fall", null)).toEqual([]);
  });
});
