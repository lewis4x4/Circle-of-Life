import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runObservationTaskGenerator } from "./engine.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY_A = "00000000-0000-0000-0000-000000000301";
const FACILITY_B = "00000000-0000-0000-0000-000000000302";
const RESIDENT_1 = "20000000-0000-4000-8000-000000000001";
const RESIDENT_2 = "20000000-0000-4000-8000-000000000002";
const STAFF_ON_CLOCK = "30000000-0000-4000-8000-000000000001";
const CADENCE = "60000000-0000-4000-8000-000000000001";
const AT = "2026-09-23T14:00:00.000Z";

type Rpc = { name: string; args: Record<string, unknown> };
type Answer = { data: unknown; error: { code: string; message: string } | null };

/** A current and a next shift window, one each, for every facility. */
function windows() {
  return [
    {
      cadence_version_id: CADENCE,
      window_key: "day_1500",
      label: "3 PM",
      shift_key: "day",
      roster_shift_type: "day",
      shift_service_date: "2026-09-23",
      service_date: "2026-09-23",
      due_at_utc: "2026-09-23T19:00:00.000Z",
      window_opens_at_utc: "2026-09-23T18:30:00.000Z",
      window_closes_at_utc: "2026-09-23T19:30:00.000Z",
      starts_shift: false,
    },
    {
      cadence_version_id: CADENCE,
      window_key: "evening_1900",
      label: "7 PM",
      shift_key: "evening",
      roster_shift_type: "evening",
      shift_service_date: "2026-09-23",
      service_date: "2026-09-23",
      due_at_utc: "2026-09-23T23:00:00.000Z",
      window_opens_at_utc: "2026-09-23T22:30:00.000Z",
      window_closes_at_utc: "2026-09-23T23:30:00.000Z",
      starts_shift: true,
    },
  ];
}

/** The day shift is on the clock; the evening shift has not started. */
function onClockResolver(args: Record<string, unknown>): Answer {
  const residents = args.p_resident_ids as string[];
  const current = args.p_roster_shift_type === "day";
  return {
    data: residents.map((resident_id) => ({
      resident_id,
      shift_assignment_id: null,
      staff_id: current ? STAFF_ON_CLOCK : null,
      assignment_source: current ? "on_clock" : "awaiting_clock_in",
    })),
    error: null,
  };
}

function fakeAdmin(options: {
  facilities: string[];
  resolve?: (args: Record<string, unknown>) => Answer;
  assignUnowned?: (args: Record<string, unknown>) => Answer;
}) {
  const calls: Rpc[] = [];
  const query = (data: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      then: (resolve: (value: Answer) => unknown) => resolve({ data, error: null }),
    };
    return chain;
  };
  const admin = {
    from(table: string) {
      if (table === "facilities") {
        return query(options.facilities.map((id) => ({ id, organization_id: ORG, entity_id: null })));
      }
      if (table === "residents") return query([{ id: RESIDENT_1 }, { id: RESIDENT_2 }]);
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>): Promise<Answer> {
      calls.push({ name, args });
      switch (name) {
        case "facility_current_and_next_shift_observation_windows":
          return Promise.resolve({ data: windows(), error: null });
        case "stand_down_ungenerated_observation_tasks":
        case "generate_monitoring_order_tasks":
          return Promise.resolve({ data: 0, error: null });
        case "observation_windows_under_monitoring_order":
          return Promise.resolve({ data: [], error: null });
        case "resolve_observation_task_assignees":
          return Promise.resolve((options.resolve ?? onClockResolver)(args));
        case "record_observation_staffing_gap":
          return Promise.resolve({ data: true, error: null });
        case "record_cadence_observation_tasks":
          return Promise.resolve({ data: (args.p_rows as unknown[]).length, error: null });
        case "assign_unowned_observation_tasks":
          return Promise.resolve((options.assignUnowned ?? (() => ({ data: 3, error: null })))(args));
        default:
          return Promise.reject(new Error(`unexpected rpc ${name}`));
      }
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

function recordingLog() {
  const entries: Record<string, unknown>[] = [];
  return { entries, log: (entry: Record<string, unknown>) => entries.push(entry) };
}

Deno.test("every facility asks for on-clock owners once, after its tasks are written, and the run reports the count", async () => {
  const { admin, calls } = fakeAdmin({ facilities: [FACILITY_A, FACILITY_B] });
  const summary = await runObservationTaskGenerator({
    admin,
    organizationId: ORG,
    facilityId: null,
    atIso: AT,
    log: recordingLog(),
  });

  const assignCalls = calls.filter((call) => call.name === "assign_unowned_observation_tasks");
  assertEquals(assignCalls.map((call) => call.args), [
    { p_facility_id: FACILITY_A, p_at: AT },
    { p_facility_id: FACILITY_B, p_at: AT },
  ]);
  for (const facility of [FACILITY_A, FACILITY_B]) {
    const assignAt = calls.findIndex((call) => call.name === "assign_unowned_observation_tasks" && call.args.p_facility_id === facility);
    const lastWrite = calls.findLastIndex((call) =>
      call.name === "record_cadence_observation_tasks"
      && (call.args.p_rows as { facility_id: string }[])[0].facility_id === facility
    );
    assert(lastWrite >= 0 && assignAt > lastWrite, "the unowned pass runs after the facility's writes");
  }
  assertEquals(summary.tasks_assigned_on_clock, 6);
  assertEquals(summary.ok, true);
});

Deno.test("an on_clock owner is written with the staff id and no shift assignment", async () => {
  const { admin, calls } = fakeAdmin({ facilities: [FACILITY_A] });
  await runObservationTaskGenerator({ admin, organizationId: ORG, facilityId: FACILITY_A, atIso: AT, log: recordingLog() });

  const rows = calls.filter((call) => call.name === "record_cadence_observation_tasks")
    .flatMap((call) => call.args.p_rows as { window_key: string; assigned_staff_id: string | null; shift_assignment_id: string | null }[]);
  const day = rows.filter((row) => row.window_key === "day_1500");
  const evening = rows.filter((row) => row.window_key === "evening_1900");
  assertEquals(day.length, 2);
  assert(day.every((row) => row.assigned_staff_id === STAFF_ON_CLOCK && row.shift_assignment_id === null));
  assertEquals(evening.length, 2);
  assert(evening.every((row) => row.assigned_staff_id === null), "the incoming shift is never owned by the shift on the clock");
});

Deno.test("the incoming shift awaiting clock in is not a staffing gap; nobody scheduled or on the clock still is", async () => {
  const awaiting = fakeAdmin({ facilities: [FACILITY_A] });
  const quiet = await runObservationTaskGenerator({
    admin: awaiting.admin,
    organizationId: ORG,
    facilityId: FACILITY_A,
    atIso: AT,
    log: recordingLog(),
  });
  assertEquals(awaiting.calls.filter((call) => call.name === "record_observation_staffing_gap").length, 0);
  assertEquals(quiet.facilities_without_staffing, 0);
  assertEquals(quiet.staffing_gaps, []);
  assertEquals(quiet.ok, true);

  const nobody = fakeAdmin({
    facilities: [FACILITY_A],
    resolve: (args) => ({
      data: (args.p_resident_ids as string[]).map((resident_id) => ({
        resident_id,
        shift_assignment_id: null,
        staff_id: null,
        assignment_source: "none_scheduled",
      })),
      error: null,
    }),
    assignUnowned: () => ({ data: 0, error: null }),
  });
  const gap = await runObservationTaskGenerator({ admin: nobody.admin, organizationId: ORG, facilityId: FACILITY_A, atIso: AT, log: recordingLog() });
  assertEquals(nobody.calls.filter((call) => call.name === "record_observation_staffing_gap").length, 2);
  assertEquals(gap.facility_ids_without_staffing, [FACILITY_A]);
  assertEquals(gap.tasks_assigned_on_clock, 0);
  assertEquals(gap.ok, false);
});

Deno.test("a failing unowned pass fails that facility, not the run", async () => {
  const { admin } = fakeAdmin({
    facilities: [FACILITY_A, FACILITY_B],
    assignUnowned: (args) =>
      args.p_facility_id === FACILITY_A
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: 2, error: null },
  });
  const summary = await runObservationTaskGenerator({ admin, organizationId: ORG, facilityId: null, atIso: AT, log: recordingLog() });
  assertEquals(summary.failed_facility_ids, [FACILITY_A]);
  assertEquals(summary.tasks_assigned_on_clock, 2);
  assertEquals(summary.ok, false);
});

Deno.test("the completion log carries the on-clock count and no resident or staff id", async () => {
  const { admin } = fakeAdmin({ facilities: [FACILITY_A] });
  const log = recordingLog();
  await runObservationTaskGenerator({ admin, organizationId: ORG, facilityId: FACILITY_A, atIso: AT, log });
  const complete = log.entries.find((entry) => entry.event === "complete");
  assertEquals(complete?.tasks_assigned_on_clock, 3);
  const text = JSON.stringify(log.entries);
  for (const id of [RESIDENT_1, RESIDENT_2, STAFF_ON_CLOCK]) assert(!text.includes(id));
});
