import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import type { ObservationTaskStatus } from "@/lib/rounding/types";
import { calculateObservationTaskStatus } from "@/lib/rounding/update-task-status";

const TERMINAL_STATUSES = new Set([
  "completed_on_time",
  "completed_late",
  "missed",
  "excused",
]);

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
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
    console.error("[rounding/tasks] get", error);
    return NextResponse.json({ error: "Could not load observation tasks" }, { status: 500 });
  }

  const tasks = ((data ?? []) as TaskListRow[]).map((task) => {
    const derivedStatus = TERMINAL_STATUSES.has(task.status)
      ? task.status
      : calculateObservationTaskStatus({
          dueAt: task.due_at,
          graceEndsAt: task.grace_ends_at,
        });

    return {
      ...task,
      derived_status: derivedStatus,
    };
  });

  return NextResponse.json({ tasks });
}
