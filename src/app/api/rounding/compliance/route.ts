import { readAllPages } from "@/lib/supabase/read-all-pages";
import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { complianceServiceDates, mapWithConcurrency } from "@/lib/rounding/compliance-day-chunks";
import {
  assertRoundingFacilityAccess,
  getRoundingRequestContext,
  isRoundingManagerRole,
} from "@/lib/rounding/auth";
import {
  summarizeObservationCompliance,
  type ComplianceRow,
} from "@/lib/rounding/observation-compliance-summary";

/**
 * Observation compliance for the Integrity tab. Spec 25A section 7.1.
 *
 * Reads `public.observation_compliance_for_range` and nothing else for the
 * numbers. The function has invoker rights on purpose, so it runs on the
 * caller's authority and answers about exactly the facilities the caller can
 * reach; that is why every read here goes through `context.actor.client` and
 * not through the service-role client. Using service role would return every
 * building in the organization and quietly reintroduce defect 1.
 *
 * The shift, hall and staff cuts are looked up as flat reads and joined here.
 * No nested embed: `residents.bed_id` to `beds.room_id` to `rooms.unit_id` to
 * `units` is three levels of PostgREST nesting this repo has not proven, and an
 * unproven embed answering `42703` is what took two tabs down. The one embed
 * used is `staff!resident_observation_tasks_assigned_staff_id_fkey`, the
 * constraint-name form, because the task table holds two foreign keys to
 * `staff` and any other form is ambiguous.
 */

/** Day reads in flight at once; bounds database load for month-long ranges. */
const COMPLIANCE_DAY_CONCURRENCY = 6;

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext({ managerOnly: true });
  if ("response" in auth) return auth.response;

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json(
      { error: "Only clinical and facility leaders can view observation compliance" },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  if (!facilityId || !from || !to) {
    return NextResponse.json({ error: "facilityId, from, and to are required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to must be calendar dates" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  }

  if (!(await assertRoundingFacilityAccess(context, facilityId))) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const client = context.actor.client;

  try {
    // One statement per service date: a whole-range call under RLS outruns the
    // 8 s statement_timeout (COL-646). See compliance-day-chunks.ts.
    const perDay = await mapWithConcurrency(complianceServiceDates(from, to), COMPLIANCE_DAY_CONCURRENCY, (day) =>
      readAllPages((start, end) => client.rpc("observation_compliance_for_range", {
        p_facility_id: facilityId,
        p_from: day,
        p_to: day,
      }, { count: "exact" }).order("resident_id").order("service_date").order("window_key").order("cadence_version_id").range(start, end)),
    );
    const rows = perDay.flatMap((day) => (day.data ?? []) as unknown as ComplianceRow[]);

    const [shifts, tasks, residents, beds, rooms, units] = await Promise.all([
      readAllPages((start, end) => client
        .from("facility_shift_definitions")
        .select("shift_key, label", { count: "exact" })
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("shift_key").range(start, end)),
      readAllPages((start, end) => client
        .from("resident_observation_tasks")
        .select(
          "id, assigned_staff_id, staff!resident_observation_tasks_assigned_staff_id_fkey(first_name, last_name, preferred_name)",
          { count: "exact" },
        )
        .eq("facility_id", facilityId)
        .gte("service_date", from)
        .lte("service_date", to)
        .is("deleted_at", null)
        .order("id").range(start, end)),
      readAllPages((start, end) => client
        .from("residents")
        .select("id, bed_id", { count: "exact" })
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("id").range(start, end)),
      readAllPages((start, end) => client
        .from("beds")
        .select("id, room_id", { count: "exact" })
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("id").range(start, end)),
      readAllPages((start, end) => client
        .from("rooms")
        .select("id, room_number, unit_id", { count: "exact" })
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("id").range(start, end)),
      readAllPages((start, end) => client
        .from("units")
        .select("id, name", { count: "exact" })
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("id").range(start, end)),
    ]);

    const shiftLabels = new Map<string, string>();
    for (const row of shifts.data ?? []) {
      if (row.shift_key) shiftLabels.set(row.shift_key, row.label ?? "No shift posted");
    }

    const staffByTask = new Map<string, { key: string; label: string }>();
    for (const row of tasks.data ?? []) {
      const person = row.staff as
        | { first_name: string | null; last_name: string | null; preferred_name: string | null }
        | null;
      const first = (person?.preferred_name ?? person?.first_name)?.trim() ?? "";
      const last = person?.last_name?.trim() ?? "";
      const label = `${first} ${last}`.trim();
      staffByTask.set(row.id, {
        key: row.assigned_staff_id ?? "no_staff",
        label: label || "No assigned staff",
      });
    }

    const unitNames = new Map((units.data ?? []).map((unit) => [unit.id, unit.name]));
    const roomById = new Map((rooms.data ?? []).map((room) => [room.id, room]));
    const bedById = new Map((beds.data ?? []).map((bed) => [bed.id, bed]));
    const hallByResident = new Map<string, { key: string; label: string }>();
    for (const resident of residents.data ?? []) {
      const room = resident.bed_id ? roomById.get(bedById.get(resident.bed_id)?.room_id ?? "") : null;
      const unitId = room?.unit_id ?? null;
      if (!unitId) continue;
      hallByResident.set(resident.id, {
        key: unitId,
        label: unitNames.get(unitId) ?? "No hall posted",
      });
    }

    return NextResponse.json(
      summarizeObservationCompliance({
        from,
        to,
        rows,
        shiftLabels,
        hallByResident,
        staffByTask,
      }),
    );
  } catch (error) {
    logError("rounding.compliance", error, { facilityId, from, to });
    return NextResponse.json({ error: "Could not load complete observation compliance" }, { status: 500 });
  }
}
