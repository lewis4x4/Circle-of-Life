import { NextResponse } from "next/server";

import { actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds, requireOperationsActor } from "@/lib/operations/auth";
import type { OperationsActor } from "@/lib/operations/auth";
import { buildOperationTaskResponse, parseOperationTaskFilters, summarizeOperationTasks } from "@/lib/operations/server";
import type { OperationTaskResponse } from "@/lib/operations/types";

type OperationTaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: "day" | "evening" | "night" | null;
  assigned_to: string | null;
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

  let accessibleFacilityIds = await listActorAccessibleFacilityIds(actor);
  if (filters.facilityId) {
    const canAccess = await actorCanAccessFacility(actor, filters.facilityId);
    if (!canAccess) {
      return NextResponse.json({ error: "Access denied to this facility" }, { status: 403 });
    }
    accessibleFacilityIds = [filters.facilityId];
  }

  if (accessibleFacilityIds.length === 0) {
    return NextResponse.json(emptyTaskResponse(filters.dateFrom, filters.dateTo));
  }

  let query = actor.admin
    .from("operation_task_instances" as never)
    .select(`
      id,
      organization_id,
      facility_id,
      template_id,
      template_name,
      template_category,
      template_cadence_type,
      assigned_shift_date,
      assigned_shift,
      assigned_to,
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
    .limit(1000);

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
    console.error("[operations/tasks] list", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as OperationTaskRow[]);
  const facilityNames = await loadFacilityNames(actor, accessibleFacilityIds);
  const assigneeNames = await loadAssigneeNames(actor, rows);

  const response = buildOperationTaskResponse({
    rows,
    facilityNames,
    assigneeNames,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (!filters.overdueOnly) {
    return NextResponse.json(response);
  }

  const overdueTasks = response.tasks.filter((task) =>
    task.days_overdue > 0 && (task.status === "pending" || task.status === "in_progress")
  );

  return NextResponse.json({
    ...response,
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

async function loadFacilityNames(
  actor: OperationsActor,
  facilityIds: string[],
) {
  const { data } = await actor.admin
    .from("facilities")
    .select("id, name")
    .eq("organization_id", actor.organizationId)
    .in("id", facilityIds);

  return new Map((data ?? []).map((facility) => [facility.id, facility.name]));
}

async function loadAssigneeNames(
  actor: OperationsActor,
  rows: OperationTaskRow[],
) {
  const assigneeIds = Array.from(new Set(rows.map((row) => row.assigned_to).filter(Boolean))) as string[];
  if (assigneeIds.length === 0) {
    return new Map<string, string>();
  }

  const { data } = await actor.admin
    .from("user_profiles")
    .select("id, full_name")
    .in("id", assigneeIds)
    .is("deleted_at", null);

  return new Map((data ?? []).map((profile) => [profile.id, profile.full_name]));
}
