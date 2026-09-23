/** Local preview only. No credentials, network fallback, or production Supabase client. */
const facilityId = "11111111-1111-4111-8111-111111111111";
const scheduleId = "synthetic-schedule";
const published = new URLSearchParams(window.location.search).get("scenario") === "published";
const schedule = {
  id: scheduleId, facility_id: facilityId, organization_id: "synthetic-org",
  week_start_date: "2026-09-28", status: published ? "published" : "draft",
  updated_at: "2026-09-23T12:00:00.000Z", published_at: published ? "2026-09-23T12:00:00.000Z" : null,
  published_by: published ? "synthetic-actor" : null, notes: "Synthetic schedule for component verification", deleted_at: null,
};
const definitions = [
  { id: "synthetic-day", facility_id: facilityId, label: "Day", roster_shift_type: "day", starts_at_local: "06:00:00", ends_at_local: "18:00:00", active: true, sort_order: 1, deleted_at: null },
  { id: "synthetic-night", facility_id: facilityId, label: "Night", roster_shift_type: "night", starts_at_local: "18:00:00", ends_at_local: "06:00:00", active: true, sort_order: 2, deleted_at: null },
];
const staff = ["A", "B", "C", "D", "E", "F"].map((letter, index) => ({
  id: `sample-${letter.toLowerCase()}`, first_name: "Sample Person", last_name: letter,
  facility_id: facilityId, staff_role: index === 0 ? "facility_admin" : "med_tech", employment_status: "active", deleted_at: null,
}));
const patterns = [[0, 1, 3], [0, 2, 4], [1, 3, 5], [2, 4, 6], [0, 3, 5], [1, 4, 6]];
type Assignment = Record<string, unknown> & { id: string; staff_id: string; shift_date: string; deleted_at: string | null };
let assignments: Assignment[] = staff.flatMap((person, index) => patterns[index].map((day) => {
  const definition = definitions[index % 2];
  return {
    id: `synthetic-assignment-${index}-${day}`, schedule_id: scheduleId, staff_id: person.id,
    facility_id: facilityId, organization_id: "synthetic-org", shift_date: new Date(Date.UTC(2026, 8, 28 + day)).toISOString().slice(0, 10),
    shift_type: definition.roster_shift_type, shift_definition_id: definition.id,
    custom_start_time: definition.starts_at_local, custom_end_time: definition.ends_at_local,
    status: "assigned", shift_classification: "regular", notes: null, deleted_at: null,
  };
}));
const calls: { name: string; args: Record<string, unknown> }[] = [];
let revision = 0;
function tableRows(table: string): Record<string, unknown>[] {
  if (table === "schedules") return [schedule];
  if (table === "staff") return staff;
  if (table === "shift_assignments") return assignments;
  if (table === "facility_shift_definitions") return definitions;
  if (table === "facilities") return [{ id: facilityId, timezone: "America/New_York" }];
  throw new Error(`Synthetic fixture does not provide table ${table}`);
}
const client = {
  from(table: string) {
    const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
    const rows = () => tableRows(table).filter((row) => predicates.every((predicate) => predicate(row)));
    const query = {
      select() { return query; },
      eq(field: string, value: unknown) { predicates.push((row) => row[field] === value); return query; },
      is(field: string, value: unknown) { predicates.push((row) => row[field] === value); return query; },
      order() { return query; },
      async maybeSingle() { return { data: structuredClone(rows()[0] ?? null), error: null }; },
      async single() { return query.maybeSingle(); },
      async range(from: number, to: number) { const all = rows(); return { data: structuredClone(all.slice(from, to + 1)), count: all.length, error: null }; },
    };
    return query;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args: structuredClone(args) });
    if (schedule.status !== "draft") return { data: null, error: { message: "Synthetic published schedule is read only" } };
    if (args.p_schedule_id !== scheduleId) throw new Error("Unexpected synthetic schedule identity");
    if (name === "schedule_bulk_upsert") {
      for (const cell of args.p_cells as { staff_id: string; shift_date: string; shift_definition_id: string | null }[]) {
        assignments = assignments.filter((row) => row.staff_id !== cell.staff_id || row.shift_date !== cell.shift_date);
        const definition = definitions.find((row) => row.id === cell.shift_definition_id);
        if (definition) assignments.push({ id: `synthetic-edit-${++revision}`, staff_id: cell.staff_id, shift_date: cell.shift_date,
          schedule_id: scheduleId, facility_id: facilityId, deleted_at: null, status: "assigned", shift_classification: "regular",
          shift_type: definition.roster_shift_type, shift_definition_id: definition.id,
          custom_start_time: definition.starts_at_local, custom_end_time: definition.ends_at_local, notes: null });
      }
    } else if (name === "schedule_publish") {
      schedule.status = "published";
      schedule.published_by = "synthetic-actor";
      schedule.published_at = "2026-09-23T13:00:00.000Z";
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", "published");
      window.history.replaceState(null, "", url);
    } else if (name === "edit_draft_schedule" && args.p_action === "remove") {
      assignments = assignments.filter((row) => row.id !== args.p_shift_id);
    } else throw new Error(`Synthetic fixture does not provide RPC ${name}`);
    schedule.updated_at = new Date(Date.UTC(2026, 8, 23, 12, 0, ++revision)).toISOString();
    return { data: scheduleId, error: null };
  },
};
export const createClient = () => client;
export const isBrowserSupabaseConfigured = () => true;
Object.assign(window, { __syntheticScheduleProof: () => structuredClone({ schedule, assignments, calls }) });
