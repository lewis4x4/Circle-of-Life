import { describe, expect, it } from "vitest";

import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import type { HomeOnTapPayload, HomeOnTapRow } from "@/lib/home/on-tap";
import {
  actionsFor,
  buildFyiRows,
  censusClearedRow,
  censusCountsMeta,
  coOperatorLine,
  dueBeforeYouLeaveCount,
  dueLabelFor,
  escalationFooter,
  greetingLine,
  rankOnTap,
  scheduleMeta,
  titleFor,
  toCensusRowView,
} from "./on-tap-model";
import { parseHomeCensusOnTap, type HomeCensusOnTap } from "./census";
import { parseHomeOnTapPayload } from "./on-tap";

const NY = "America/New_York";
const NOW = new Date("2026-09-22T13:12:00Z"); // Tuesday 9:12 AM in New York

function row(overrides: Partial<HomeOnTapRow> & { id: string }): HomeOnTapRow {
  return {
    instanceId: overrides.id.replace(/^oti:/, ""),
    bucket: "assigned",
    title: "Weekly staff meeting",
    status: "pending",
    assignedShiftDate: "2026-09-22",
    owner: { kind: "queue" },
    href: "/admin/operations/work?facility_id=f",
    ...overrides,
  };
}

function feed(overrides: Partial<HomeOnTapPayload> = {}): HomeOnTapPayload {
  return {
    facilityId: "f",
    facilityName: "Sample Lodge",
    timezone: NY,
    asOf: NOW.toISOString(),
    localDate: "2026-09-22",
    isWeekend: false,
    endOfDayLocal: "17:00",
    escalatesTo: { userId: "exec", displayName: "Pat Example", title: "Facility Executive" },
    coOperators: [],
    onDutyToday: [],
    counts: { regulatory: 0, assigned: 0, clearedToday: 0, later: 0 },
    rows: [],
    later: [],
    cleared: [],
    ...overrides,
  };
}

const emptyQueues: AdminDashboardSnapshot["workflowQueues"] = {
  doctrinePendingReview: 0, doctrineBlockedReview: 0, doctrineReadyToPublish: 0, doctrineDueSoon: 0, doctrineOverdue: 0,
  incidentOverdueFollowups: 0, incidentUnassignedFollowups: 0, incidentEscalatedFollowups: 0, incidentOpenObligations: 0,
  incidentRootCausePending: 0, incidentCarePlanPending: 0, admissionsBlocked: 0, admissionsMoveInReady: 0,
  admissionsOnboardingPending: 0, referralsInAdmissions: 0, referralsBlockedHandoffs: 0, referralsReadyHandoffs: 0,
  referralsOnboardingHandoffs: 0, dischargePlanning: 0, dischargePharmacistReview: 0, dischargeReadyToComplete: 0,
  familyTriagePending: 0, familyConferencesUpcoming: 0,
};

describe("greeting", () => {
  it("uses the first name and never the email local-part", () => {
    expect(greetingLine("Charlene Example")).toBe("Hello, Charlene.");
    expect(greetingLine("  ")).toBe("Hello.");
    expect(greetingLine(null)).toBe("Hello.");
  });
});

describe("generator row", () => {
  const generator = row({
    id: "oti:gen",
    bucket: "regulatory",
    title: "Generator weekly run",
    catalogKey: "hfo-al-w01-01",
    dueAt: "2026-09-22T14:00:00Z",
    assetSchedule: { assetName: "Emergency generator", weekday: 2, localTime: "10:00:00", setAt: "2026-08-14T15:00:00Z" },
  });

  it("carries both clearance actions with the note rule on the negative one", () => {
    expect(actionsFor(generator)).toEqual([
      { key: "did_not_run", label: "Did not run", tone: "danger", requiresNote: true },
      { key: "ran", label: "It ran", tone: "primary" },
    ]);
    expect(titleFor(generator)).toBe("Generator weekly run — listen and confirm it ran");
  });

  it("reads the time from the asset schedule and counts down client-side", () => {
    expect(dueLabelFor(generator, { now: NOW, timeZone: NY, localDate: "2026-09-22" })).toBe("Today 10:00 AM · in 48 min");
    expect(scheduleMeta(generator)).toBe("Schedule: Tue 10:00 AM · set 08/14");
    const reset = { ...generator, dueAt: "2026-09-24T18:30:00Z", assetSchedule: { ...generator.assetSchedule, weekday: 4, localTime: "14:30:00" } };
    expect(scheduleMeta(reset)).toBe("Schedule: Thu 2:30 PM · set 08/14");
  });

  it("says before-you-leave for rows without a clock and flags carried-over rows", () => {
    expect(dueLabelFor(row({ id: "oti:a" }), { now: NOW, timeZone: NY, localDate: "2026-09-22" })).toBe("Before you leave");
    expect(dueLabelFor(row({ id: "oti:b", assignedShiftDate: "2026-09-18", overdue: true }), { now: NOW, timeZone: NY, localDate: "2026-09-22" })).toBe("Overdue · 09/18");
  });

  it("offers a generic clearance on every other row", () => {
    expect(actionsFor(row({ id: "oti:x" }))).toEqual([{ key: "done", label: "Done", tone: "primary" }]);
    expect(actionsFor(row({ id: "oti:y", requiresDualSign: true }))).toEqual([{ key: "done", label: "Sign", tone: "primary" }]);
  });
});

describe("ranking and cap", () => {
  it("keeps bucket order, caps at seven, and spills the rest under Later with their tags", () => {
    const rows: HomeOnTapRow[] = [
      row({ id: "oti:a1", bucket: "assigned", dueAt: "2026-09-22T20:00:00Z" }),
      row({ id: "oti:r1", bucket: "regulatory", dueAt: "2026-09-22T15:00:00Z" }),
      row({ id: "oti:a2", bucket: "assigned", dueAt: "2026-09-22T19:00:00Z" }),
      row({ id: "oti:r2", bucket: "regulatory", dueAt: "2026-09-22T14:00:00Z" }),
      row({ id: "oti:a3", bucket: "assigned" }),
      row({ id: "oti:a4", bucket: "assigned" }),
    ];
    const queues = { ...emptyQueues, referralsReadyHandoffs: 1, incidentOverdueFollowups: 2, admissionsBlocked: 1, familyTriagePending: 1 };
    const ranked = rankOnTap({
      feed: feed({ rows, counts: { regulatory: 2, assigned: 4, clearedToday: 1, later: 1 }, later: [row({ id: "oti:l1", bucket: "regulatory", assignedShiftDate: "2026-09-25" })] }),
      fyi: buildFyiRows(queues),
      now: NOW,
      currentUserId: "me",
    });
    expect(ranked.rows).toHaveLength(7);
    expect(ranked.rows.map((r) => r.id)).toEqual(["oti:r2", "oti:r1", "oti:a2", "oti:a1", "oti:a3", "oti:a4", "fyi:referrals-ready"]);
    expect(ranked.later.map((r) => r.id)).toEqual(["fyi:incidents-overdue", "fyi:admissions-blocked", "fyi:family-triage", "oti:l1"]);
    expect(ranked.later[0].tags.map((t) => t.label)).toEqual(["FYI", "Overdue"]);
    expect(ranked.later[3].disabledReason).toBe("Opens 09/25");
    expect(ranked.counts).toEqual({ regulatory: 2, rent: 0, assigned: 4, fyi: 4, clearedToday: 1, later: 4 });
    expect(dueBeforeYouLeaveCount(ranked)).toBe(6);
  });

  it("gives every operation row a clearance action and every FYI row a link", () => {
    const ranked = rankOnTap({ feed: feed({ rows: [row({ id: "oti:a" })] }), fyi: buildFyiRows({ ...emptyQueues, incidentUnassignedFollowups: 1 }), now: NOW, currentUserId: null });
    for (const view of ranked.rows) {
      expect(view.actions.length).toBeGreaterThan(0);
    }
    expect(ranked.rows[1].actions[0]).toEqual({ key: "open", label: "Assign", tone: "default", href: "/admin/incidents/followups?filter=unassigned" });
  });
});

describe("copy", () => {
  it("names who is on and where the uncleared work goes", () => {
    expect(coOperatorLine({ onDutyToday: [{ userId: "m", displayName: "Morgan Example" }], coOperators: [] })).toBe("Morgan is on today too");
    expect(coOperatorLine({ onDutyToday: [], coOperators: [{ userId: "m", displayName: "Morgan Example" }] })).toBe("Morgan also covers this building");
    expect(coOperatorLine({ onDutyToday: [], coOperators: [] })).toBeNull();
    expect(escalationFooter(feed())).toContain("Anything unclaimed and uncleared at 5:00 PM goes to Pat Example, Facility Executive.");
    expect(escalationFooter(feed({ escalatesTo: null }))).toContain("not yet named");
  });
});

describe("payload validation", () => {
  it("refuses a payload that is not the feed", () => {
    expect(() => parseHomeOnTapPayload({ rows: [] })).toThrow(/unexpected payload/);
    expect(parseHomeOnTapPayload(feed()).facilityName).toBe("Sample Lodge");
  });
});

describe("monthly census on tap (COL-569)", () => {
  const due: HomeCensusOnTap = {
    due: true,
    censusMonth: "2026-09-01",
    firstBusinessDay: "2026-10-01",
    status: "open",
    canRecord: true,
    snapshot: { daysInMonth: 30, daysLogged: 28, averageOccupied: 46.2, monthEndOccupied: 47, rosterCensus: 48 },
    confirmed: null,
    lastFlag: null,
  };

  it("adds no row when the database says it is not the first business day", () => {
    expect(toCensusRowView({ ...due, due: false, status: null, snapshot: null }, {})).toBeNull();
    const ranked = rankOnTap({ feed: feed(), fyi: [], now: NOW, currentUserId: "me", census: { ...due, due: false } });
    expect(ranked.rows).toHaveLength(0);
    expect(dueBeforeYouLeaveCount(ranked)).toBe(0);
  });

  it("ranks an open month as an assigned row with Confirm and Something wrong", () => {
    const ranked = rankOnTap({ feed: feed(), fyi: [], now: NOW, currentUserId: "me", census: due });
    expect(ranked.rows.map((r) => r.id)).toEqual(["census:2026-09-01"]);
    const view = ranked.rows[0];
    expect(view.title).toBe("Confirm census for September 2026");
    expect(view.clearTarget).toBe("census:2026-09-01");
    expect(view.actions.map((a) => a.key)).toEqual(["census_flag", "census_confirm"]);
    expect(view.actions[0].requiresNote).toBe(true);
    expect(view.meta).toContain("Confirming notifies Pat Example");
    expect(dueBeforeYouLeaveCount(ranked)).toBe(1);
  });

  it("keeps a flagged month open and shows who flagged it", () => {
    const view = toCensusRowView({ ...due, status: "flagged", lastFlag: { at: "2026-10-01T14:00:00Z", by: "Ada Operator", note: "Two move-outs not entered" } }, {});
    expect(view?.meta).toContain("Ada flagged: Two move-outs not entered");
    expect(view?.tags.map((t) => t.label)).toEqual(["Census", "Open"]);
  });

  it("moves a confirmed month to cleared and off the queue", () => {
    const confirmed = { ...due, status: "confirmed" as const, confirmed: { at: "2026-10-01T14:05:00Z", by: "Ada Operator" } };
    expect(toCensusRowView(confirmed, {})).toBeNull();
    expect(censusClearedRow(confirmed)).toMatchObject({ title: "Confirm census for September 2026", by: "Ada Operator" });
    const ranked = rankOnTap({ feed: feed(), fyi: [], now: NOW, currentUserId: "me", census: confirmed });
    expect(ranked.counts.clearedToday).toBe(1);
  });

  it("offers no clearance to a caller who cannot attest", () => {
    const view = toCensusRowView({ ...due, canRecord: false }, {});
    expect(view?.actions).toEqual([]);
    expect(view?.clearTarget).toBeNull();
    expect(view?.disabledReason).toBe("Administrator or manager confirms");
  });

  it("formats counts only and parses the database payload", () => {
    expect(censusCountsMeta(due.snapshot)).toBe("Roster 48 · Month-end 47 · Avg 46.2 · 28/30 days logged");
    const parsed = parseHomeCensusOnTap({
      due: true, censusMonth: "2026-09-01", firstBusinessDay: "2026-10-01", status: "open", canRecord: true,
      snapshot: { daysInMonth: 30, daysLogged: 0, averageOccupied: null, rosterCensus: 12 },
    });
    expect(parsed).toMatchObject({ due: true, status: "open", canRecord: true, confirmed: null, lastFlag: null });
    expect(parsed?.snapshot?.rosterCensus).toBe(12);
    expect(parseHomeCensusOnTap({ nope: true })).toBeNull();
  });
});
