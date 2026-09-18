import { expect, test } from "@playwright/test";

import {
  adminClient,
  facilityId,
  facilityTimezone,
  projectedWindows,
  serviceDateIn,
  skipUnlessEnabled,
} from "./_helpers";

/**
 * Spec 25A acceptance item 2: the `shift_change_am` window does not accept an
 * observation recorded before its opening instant, and `mid_morning` does
 * accept one an hour before it is due.
 *
 * What "accept" means here, precisely. `public.submit_observation` records a
 * log at whatever `observed_at` it is handed; it does not police the window,
 * and it should not, because a late entry with a reason is a real thing that
 * happens on a floor. The window either counts the log or it does not, and that
 * decision lives in `public.observation_compliance_for_range`: a projected
 * window is satisfied when a log for that resident falls inside its span.
 * Acceptance 2 is therefore a statement about the span, and this file asserts
 * the span and the satisfaction rule rather than a refusal that does not exist.
 *
 * Nothing here holds a time. The window keys come from the spec, the spans come
 * from `facility_observation_windows_for_date`, and the asymmetry decision 2
 * describes is read out of the rows. If a building moves its morning check the
 * assertions move with it, which is the whole point of the module.
 */
skipUnlessEnabled();

const SHIFT_CHANGE_AM = "shift_change_am";
const MID_MORNING = "mid_morning";

test.describe("window acceptance", () => {
  test("the shift change window opens at its due instant and the mid morning window opens before its own", async () => {
    const admin = adminClient();
    const facility = facilityId();
    const zone = await facilityTimezone(admin, facility);
    const windows = await projectedWindows(admin, facility, serviceDateIn(zone));

    const shiftChange = windows.find((window) => window.window_key === SHIFT_CHANGE_AM);
    const midMorning = windows.find((window) => window.window_key === MID_MORNING);
    expect(shiftChange, `the cadence in force at ${facility} has no ${SHIFT_CHANGE_AM} window`).toBeTruthy();
    expect(midMorning, `the cadence in force at ${facility} has no ${MID_MORNING} window`).toBeTruthy();
    if (!shiftChange || !midMorning) return;

    const opens = (window: typeof shiftChange) => new Date(window.window_opens_at_utc).getTime();
    const due = (window: typeof shiftChange) => new Date(window.due_at_utc).getTime();
    const closes = (window: typeof shiftChange) => new Date(window.window_closes_at_utc).getTime();

    // Decision 2: shift change windows are asymmetric, nothing before and a
    // full grace after. So the span cannot start before the check is due, and
    // an instant one minute earlier is outside it.
    expect(
      opens(shiftChange),
      "the shift change window opens before it is due, so a check recorded before the incoming shift arrived would satisfy it",
    ).toBe(due(shiftChange));
    expect(closes(shiftChange)).toBeGreaterThan(due(shiftChange));

    // The mid morning window carries grace on both sides, so its span starts
    // before it is due. The magnitude is the row's; this asserts the direction.
    expect(
      opens(midMorning),
      "the mid morning window has no grace before it is due, which contradicts the cadence this module seeds",
    ).toBeLessThan(due(midMorning));
    expect(closes(midMorning)).toBeGreaterThan(due(midMorning));

    const graceBeforeMidMorning = (due(midMorning) - opens(midMorning)) / 60_000;
    console.log(
      `[smart-rounding] ${SHIFT_CHANGE_AM} grace before 0 minutes, ${MID_MORNING} grace before ${graceBeforeMidMorning} minutes, both read from the version in force`,
    );
  });

  test("an instant before the shift change window is outside it and the mid morning window's own opening instant is inside it", async () => {
    const admin = adminClient();
    const facility = facilityId();
    const zone = await facilityTimezone(admin, facility);
    const windows = await projectedWindows(admin, facility, serviceDateIn(zone));

    const shiftChange = windows.find((window) => window.window_key === SHIFT_CHANGE_AM);
    const midMorning = windows.find((window) => window.window_key === MID_MORNING);
    if (!shiftChange || !midMorning) {
      throw new Error(`the cadence in force at ${facility} is missing ${SHIFT_CHANGE_AM} or ${MID_MORNING}`);
    }

    const inside = (window: typeof shiftChange, at: Date) =>
      at.getTime() >= new Date(window.window_opens_at_utc).getTime() &&
      at.getTime() < new Date(window.window_closes_at_utc).getTime();

    // One minute is the smallest step the module records, not a policy value.
    const oneMinute = 60_000;
    const justBeforeShiftChange = new Date(new Date(shiftChange.window_opens_at_utc).getTime() - oneMinute);
    expect(
      inside(shiftChange, justBeforeShiftChange),
      "an observation recorded before the shift change window opens fell inside it",
    ).toBe(false);

    const atMidMorningOpening = new Date(midMorning.window_opens_at_utc);
    expect(
      inside(midMorning, atMidMorningOpening),
      "an observation recorded at the mid morning window's own opening instant fell outside it",
    ).toBe(true);
  });

  test("every satisfied window in the compliance record was satisfied inside its own span", async () => {
    // The behavioural half, asserted against what the building actually
    // recorded rather than against a log this test writes. Observation logs are
    // immutable: migration 331 puts a BEFORE UPDATE trigger on them that
    // refuses every update from every role, so a log written by a test cannot
    // be withdrawn afterwards. An acceptance run that leaves permanent clinical
    // records behind on the target project is not a cost worth paying for an
    // assertion the existing record already supports.
    const admin = adminClient();
    const facility = facilityId();
    const zone = await facilityTimezone(admin, facility);
    const serviceDate = serviceDateIn(zone);

    const { data, error } = await admin.rpc("observation_compliance_for_range", {
      p_facility_id: facility,
      p_from: serviceDate,
      p_to: serviceDate,
    });
    expect(error, error ? `observation_compliance_for_range failed: ${error.message}` : undefined).toBeNull();

    type ComplianceRow = {
      window_key: string | null;
      satisfied: boolean;
      satisfied_at: string | null;
      window_opens_at_utc: string | null;
      window_closes_at_utc: string | null;
      expectation_source: string;
    };
    const rows = (data ?? []) as ComplianceRow[];
    expect(rows.length, `no compliance rows for ${facility} on ${serviceDate}; the read is meant to speak about every resident day`).toBeGreaterThan(0);

    const outOfSpan = rows.filter((row) => {
      if (!row.satisfied || !row.satisfied_at || !row.window_opens_at_utc || !row.window_closes_at_utc) return false;
      const at = new Date(row.satisfied_at).getTime();
      return at < new Date(row.window_opens_at_utc).getTime() || at >= new Date(row.window_closes_at_utc).getTime();
    });
    expect(
      outOfSpan.length,
      "a window reads as satisfied by a log recorded outside its own span, which is compliance counting a check nobody made in that window",
    ).toBe(0);

    const unconfigured = rows.filter((row) => row.expectation_source === "no_cadence").length;
    console.log(
      `[smart-rounding] ${rows.length} compliance rows, ${rows.filter((row) => row.satisfied).length} satisfied, ${unconfigured} unconfigured`,
    );
  });
});
