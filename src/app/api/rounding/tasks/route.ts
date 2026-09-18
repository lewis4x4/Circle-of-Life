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
  } | null;
};

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if ("response" in auth) return auth.response;

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();
  const residentId = searchParams.get("residentId")?.trim();
  const status = searchParams.get("status")?.trim();
  const limit = Math.min(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  let query = context.admin
    .from("resident_observation_tasks")
    .select(`
      *,
      residents(id, first_name, last_name, preferred_name, bed_id),
      staff!resident_observation_tasks_assigned_staff_id_fkey(id, first_name, last_name, preferred_name),
      shift_assignments(id, shift_type, shift_date)
    `)
    .eq("organization_id", context.organizationId)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true })
    .limit(limit);

  if (!isRoundingManagerRole(context.appRole)) {
    if (!context.currentStaffId) {
      return NextResponse.json({ error: "No caregiver staff profile found" }, { status: 403 });
    }
    query = query.eq("assigned_staff_id", context.currentStaffId);
  }

  if (residentId) {
    query = query.eq("resident_id", residentId);
  }
  if (status) {
    const statusFilter = status as ObservationTaskStatus;
    if (!TASK_STATUS_FILTERS.has(statusFilter)) {
      return NextResponse.json({ error: `Invalid status filter: ${status}` }, { status: 400 });
    }
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
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

  const tasks = ((data ?? []) as TaskListRow[]).map((task) => ({
    ...task,
    derived_status: policy
      ? calculateObservationTaskStatus({
          status: task.status as ObservationTaskStatus,
          dueAt: task.due_at,
          graceEndsAt: task.grace_ends_at,
          policy,
        })
      : task.status,
  }));

  return NextResponse.json({ tasks, board_policy_gap: policyGap });
}
