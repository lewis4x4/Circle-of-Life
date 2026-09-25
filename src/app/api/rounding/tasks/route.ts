import { readAllPages } from "@/lib/supabase/read-all-pages";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { NextResponse } from "next/server";
import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import { ObservationBoardPolicyMissing, fetchObservationBoardPolicy } from "@/lib/rounding/board-policy-fetch";
import type { ObservationTaskStatus } from "@/lib/rounding/types";
import { calculateObservationTaskStatus } from "@/lib/rounding/update-task-status";

const TASK_STATUS_FILTERS = new Set<ObservationTaskStatus>([
  "upcoming",
  "due_soon",
  "due_now",
  "overdue",
  "critically_overdue",
  "missed",
  "completed_on_time",
  "completed_late",
  "excused",
  "reassigned",
  "escalated",
]);

type TaskListRow = {
  id: string;
  assigned_staff_id: string | null;
  resident_observation_assignments?: Array<{ staff_id: string; released_at: string | null }>;
  status: string;
  due_at: string;
  grace_ends_at: string;
  residents: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    bed_id: string | null;
  } | null;
  staff: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  } | null;
  shift_assignments: {
    id: string;
    shift_type: string | null;
    shift_date: string | null;
    schedule_preset_name: string | null;
    schedule_starts_at: string | null;
    schedule_ends_at: string | null;
    schedule_time_zone: string | null;
  } | null;
};

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if ("response" in auth) return auth.response;

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();
  const residentId = searchParams.get("residentId")?.trim();
  const taskId = searchParams.get("taskId")?.trim();
  const queue = searchParams.get("queue") === "1";
  const status = searchParams.get("status")?.trim();
  const limit = Math.min(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  if (!isRoundingManagerRole(context.appRole) && !context.currentStaffId) {
    return NextResponse.json({ error: "No caregiver staff profile found" }, { status: 403 });
  }
  const makeQuery = () => {
    let query = context.admin
      .from("resident_observation_tasks")
      .select(`
        *,
        residents(id, first_name, last_name, preferred_name, bed_id),
        staff!resident_observation_tasks_assigned_staff_id_fkey(id, first_name, last_name, preferred_name),
        shift_assignments(id, shift_type, shift_date, schedule_preset_name, schedule_starts_at, schedule_ends_at, schedule_time_zone),
        resident_observation_assignments(staff_id, released_at)
      `, { count: "exact" })
      .eq("organization_id", context.organizationId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("due_at", { ascending: true })
      .order("id");

    if (taskId) query = query.eq("id", taskId);
    if (queue && !taskId) {
      query = query.or(`status.not.in.(completed_on_time,completed_late,excused),service_date.eq.${todayFacilityDateIso()}`);
    }
    if (residentId) {
      query = query.eq("resident_id", residentId);
    }
    if (status) query = query.eq("status", status as ObservationTaskStatus);
    return query;
  };
  if (status && !TASK_STATUS_FILTERS.has(status as ObservationTaskStatus)) {
    return NextResponse.json({ error: `Invalid status filter: ${status}` }, { status: 400 });
  }
  let result;
  try {
    result = queue && !taskId
      ? await readAllPages((from, to) => makeQuery().range(from, to))
      : await makeQuery().limit(taskId ? 1 : Math.max(1, limit));
  } catch (error) {
    logError("rounding.tasks.get", error, { facilityId });
    return NextResponse.json({ error: "Could not load all observation tasks" }, { status: 500 });
  }

  const { data, error } = result;
  if (error) {
    logError("rounding.tasks.get", error, { facilityId, status });
    return NextResponse.json({ error: "Could not load observation tasks" }, { status: 500 });
  }

  // The board's display bands are configuration, not constants. The lead time
  // comes from facility_observation_thresholds and the escalation side comes
  // from the rungs of the escalation version in force, which is the same answer
  // record_observation_escalation_rung fires from. Read once per request
  // rather than per row.
  //
  // A facility with no thresholds row or no escalation version in force is a
  // configuration gap, and the response says so instead of inventing bands: the
  // rows still come back carrying the status the server wrote, which is the
  // truthful answer, with the gap named alongside them.
  let policy = null;
  let policyGap: string | null = null;
  try {
    policy = await fetchObservationBoardPolicy(context.admin, facilityId);
  } catch (cause) {
    if (!(cause instanceof ObservationBoardPolicyMissing)) throw cause;
    policyGap = cause.reason;
    logError("rounding.tasks.board-policy", cause, { facilityId, reason: cause.reason, postgrestCode: cause.postgrestCode });
  }

  const tasks = ((data ?? []) as TaskListRow[]).map(({ resident_observation_assignments, ...task }) => {
    const activeAssignments = (resident_observation_assignments ?? []).filter((row) => row.released_at == null);
    const ownsCheck = activeAssignments.length
      ? activeAssignments.some((row) => row.staff_id === context.currentStaffId)
      : task.assigned_staff_id === context.currentStaffId;
    return {
      ...task,
    requires_claim: !isRoundingManagerRole(context.appRole) && !ownsCheck,
    derived_status: policy
      ? calculateObservationTaskStatus({
          status: task.status as ObservationTaskStatus,
          dueAt: task.due_at,
          graceEndsAt: task.grace_ends_at,
          policy,
        })
      : task.status,
    };
  });

  return NextResponse.json({ tasks, board_policy_gap: policyGap });
}
