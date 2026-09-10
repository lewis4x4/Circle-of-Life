import { NextResponse } from "next/server";

import { actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds, requireOperationsActor } from "@/lib/operations/auth";
import type { OperationsActor } from "@/lib/operations/auth";
import { buildOperationTaskResponse, parseOperationTaskFilters, summarizeOperationTasks } from "@/lib/operations/server";
import type { OperationTaskResponse } from "@/lib/operations/types";
import { logError } from "@/lib/observability/logger";

const AUTHORIZED_TASK_COVERAGE = {
  scope: "currently_authorized_classified_tasks",
  legacy_classification_required: true,
  evidence_scope: "classified_only",
} as const;

type OperationTaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  activity_id?: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: "day" | "evening" | "night" | null;
  assigned_to: string | null;
  signed_by?: string | null;
  requires_dual_sign?: boolean;
  assigned_role: string | null;
  status: "pending" | "in_progress" | "completed" | "missed" | "deferred" | "cancelled";
  due_at: string | null;
  missed_at: string | null;
  deferred_until: string | null;
  priority: "critical" | "high" | "normal" | "low" | null;
  license_threatening: boolean | null;
  estimated_minutes: number | null;
  current_escalation_level: number | null;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  if (!actorCanViewOperations(actor)) {
    return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filters = parseOperationTaskFilters(searchParams);

  let accessibleFacilityIds: string[];
  try {
    accessibleFacilityIds = await listActorAccessibleFacilityIds(actor);
  } catch {
    return NextResponse.json({ error: "Could not verify facility access" }, { status: 503 });
  }
  if (filters.facilityId) {
    const canAccess = await actorCanAccessFacility(actor, filters.facilityId);
    if (!canAccess) {
      return NextResponse.json({ error: "Access denied to this facility" }, { status: 403 });
    }
    accessibleFacilityIds = [filters.facilityId];
  }

  if (accessibleFacilityIds.length === 0) {
    return NextResponse.json({ ...emptyTaskResponse(filters.dateFrom, filters.dateTo), coverage: AUTHORIZED_TASK_COVERAGE });
  }

  // Bound the result set. Caller can request more via ?limit up to a hard ceiling.
  const DEFAULT_TASK_LIMIT = 250;
  const MAX_TASK_LIMIT = 1000;
  const requestedLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const effectiveLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_TASK_LIMIT)
      : DEFAULT_TASK_LIMIT;

  let query = actor.currentActor.client
    .from("operation_task_instances" as never)
    .select(`
      id,
      organization_id,
      facility_id,
      template_id,
      activity_id,
      template_name,
      template_category,
      template_cadence_type,
      assigned_shift_date,
      assigned_shift,
      assigned_to,
      signed_by,
      requires_dual_sign,
      assigned_role,
      status,
      due_at,
      missed_at,
      deferred_until,
      priority,
      license_threatening,
      estimated_minutes,
      current_escalation_level,
      created_at,
      updated_at
    `)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .in("facility_id", accessibleFacilityIds)
    .gte("assigned_shift_date", filters.dateFrom)
    .lte("assigned_shift_date", filters.dateTo)
    .limit(effectiveLimit);

  if (actor.appRole === "housekeeper") query = query.or(`assigned_to.eq.${actor.id},and(assigned_to.is.null,assigned_role.eq.housekeeper)`);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.category) {
    query = query.eq("template_category", filters.category);
  }
  if (filters.priority) {
    query = query.eq("priority", filters.priority);
  }
  if (filters.shift) {
    query = query.eq("assigned_shift", filters.shift);
  }
  if (filters.assigneeRole) {
    query = query.eq("assigned_role", filters.assigneeRole);
  }

  const { data, error } = await query.order("assigned_shift_date", { ascending: true }).order("created_at", { ascending: true });
  if (error) {
    logError("admin.operations.tasks.list", error, {
      facilityCount: accessibleFacilityIds.length,
      limit: effectiveLimit,
    });
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as OperationTaskRow[]);
  let facilities: { names: Map<string, string>; timezones: Map<string, string | null> };
  let assigneeNames: Map<string, string>;
  try {
    facilities = await loadFacilityDetails(actor, accessibleFacilityIds);
    assigneeNames = await loadAssigneeNames(actor, rows);
  } catch {
    return NextResponse.json({ error: "Failed to load task details" }, { status: 503 });
  }

  const response = buildOperationTaskResponse({
    rows,
    facilityNames: facilities.names,
    facilityTimezones: facilities.timezones,
    assigneeNames,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (!filters.overdueOnly) {
    return NextResponse.json({ ...response, coverage: AUTHORIZED_TASK_COVERAGE });
  }

  // Only the evaluator's judgment makes a task overdue; unknown schedules are excluded.
  const overdueTasks = response.tasks.filter((task) => task.due_judgment === "overdue");

  return NextResponse.json({
    ...response,
    coverage: AUTHORIZED_TASK_COVERAGE,
    tasks: overdueTasks,
    summary: summarizeOperationTasks(overdueTasks, filters.dateFrom, filters.dateTo),
    pagination: {
      page: 1,
      per_page: overdueTasks.length,
      total: overdueTasks.length,
    },
  });
}

function emptyTaskResponse(dateFrom: string, dateTo: string): OperationTaskResponse {
  return {
    tasks: [],
    summary: summarizeOperationTasks([], dateFrom, dateTo),
    pagination: {
      page: 1,
      per_page: 0,
      total: 0,
    },
  };
}

/** Names for display and each facility's own timezone for the due judgment (COL-137). */
async function loadFacilityDetails(
  actor: OperationsActor,
  facilityIds: string[],
) {
  const { data, error } = await actor.currentActor.client
    .from("facilities")
    .select("id, name, timezone")
    .eq("organization_id", actor.organizationId)
    .in("id", facilityIds);

  if (error) throw new Error("Task details unavailable");
  const facilities = data ?? [];
  return {
    names: new Map(facilities.map((facility) => [facility.id, facility.name])),
    timezones: new Map(facilities.map((facility) => [facility.id, facility.timezone ?? null])),
  };
}

async function loadAssigneeNames(
  actor: OperationsActor,
  rows: OperationTaskRow[],
) {
  const assigneeIds = Array.from(new Set(rows.map((row) => row.assigned_to).filter(Boolean))) as string[];
  if (assigneeIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await actor.currentActor.client
    .from("user_profiles")
    .select("id, full_name")
    .in("id", assigneeIds)
    .is("deleted_at", null);

  if (error) throw new Error("Task details unavailable");
  return new Map((data ?? []).map((profile) => [profile.id, profile.full_name]));
}
