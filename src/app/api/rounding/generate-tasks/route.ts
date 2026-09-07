import { NextResponse } from "next/server";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getAccessibleRoundingFacilityIds, getRoundingRequestContext, isRoundingManagerRole, revalidateRoundingRequestContext } from "@/lib/rounding/auth";
import { generateObservationTasks } from "@/lib/rounding/generate-observation-tasks";
import type { GeneratedTaskInput, PlanRuleInput } from "@/lib/rounding/types";

type Body = {
  facilityId?: string;
  planId?: string;
  windowStart?: string;
  windowEnd?: string;
  shiftDate?: string;
  shift?: "day" | "evening" | "night" | "custom";
};

type ShiftAssignmentRecord = {
  id: string;
  staff_id: string;
  shift_type: "day" | "evening" | "night" | "custom";
};

type PlanRuleRecord = {
  id: string;
  interval_type: PlanRuleInput["intervalType"];
  interval_minutes: number | null;
  shift: PlanRuleInput["shift"];
  daypart_start: string | null;
  daypart_end: string | null;
  days_of_week: number[] | null;
  grace_minutes: number;
  required_fields_schema: Record<string, unknown> | null;
  escalation_policy_key: string | null;
  sort_order: number;
  active: boolean;
  deleted_at: string | null;
};

type PlanRecord = {
  id: string;
  resident_id: string;
  facility_id: string;
  entity_id: string | null;
};

type PlanWatchRecord = {
  id: string;
  resident_id: string;
  status: string;
};

function buildShiftWindow(shiftDate?: string, shift?: Body["shift"]) {
  if (!shiftDate || !shift) {
    return null;
  }

  const start = new Date(`${shiftDate}T00:00:00`);
  const end = new Date(start);
  if (shift === "day") {
    start.setHours(7, 0, 0, 0);
    end.setHours(15, 0, 0, 0);
  } else if (shift === "evening") {
    start.setHours(15, 0, 0, 0);
    end.setHours(23, 0, 0, 0);
  } else if (shift === "night") {
    start.setHours(23, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    end.setHours(7, 0, 0, 0);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

export async function POST(request: Request) {
  const auth = await getRoundingRequestContext({ managerOnly: true });
  if ("response" in auth) return auth.response;

  let { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can generate tasks" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shiftWindow = buildShiftWindow(body.shiftDate, body.shift);
  const requestedFacilityId = body.facilityId?.trim();
  const windowStart = body.windowStart ? new Date(body.windowStart) : shiftWindow?.start;
  const windowEnd = body.windowEnd ? new Date(body.windowEnd) : shiftWindow?.end;
  if (!windowStart || !windowEnd || Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
    return NextResponse.json({ error: "A valid windowStart/windowEnd or shiftDate/shift is required" }, { status: 400 });
  }
  if (!body.planId && !requestedFacilityId) {
    return NextResponse.json({ error: "facilityId is required when planId is not provided" }, { status: 400 });
  }
  if (requestedFacilityId && !(await assertRoundingFacilityAccess(context, requestedFacilityId))) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const accessibleFacilityIds = body.planId
    ? await getAccessibleRoundingFacilityIds(context)
    : [];
  const basePlanQuery = context.admin
    .from("resident_observation_plans")
    .select("id, resident_id, facility_id, entity_id")
    .eq("organization_id", context.organizationId)
    .eq("status", "active")
    .is("deleted_at", null);

  const { data: plansData, error: plansError } = body.planId
    ? await basePlanQuery.eq("id", body.planId).in("facility_id", accessibleFacilityIds)
    : await basePlanQuery.eq("facility_id", requestedFacilityId!);

  if (plansError) {
    logError("rounding.generate-tasks", plansError, { action: "load_plans", planId: body.planId, facilityId: requestedFacilityId });
    return NextResponse.json({ error: "Could not load observation plans" }, { status: 500 });
  }

  const plans = (plansData ?? []) as PlanRecord[];
  if (plans.length === 0) {
    return NextResponse.json({ generated: 0, inserted: 0, plans: 0 });
  }

  const facilityId = requestedFacilityId || plans[0]?.facility_id;
  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const mismatchedPlan = plans.find((p) => p.facility_id !== facilityId);
  if (mismatchedPlan) {
    return NextResponse.json({ error: "Plan facility does not match requested facility" }, { status: 400 });
  }

  if (!(await assertRoundingFacilityAccess(context, facilityId))) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const planIds = plans.map((plan) => plan.id);
  const residentIds = [...new Set(plans.map((plan) => plan.resident_id))];

  const shiftDate = body.shiftDate ?? todayFacilityDateIso(windowStart);
  const { data: assignmentsData, error: assignmentsError } = await context.admin
    .from("shift_assignments")
    .select("id, staff_id, shift_type")
    .eq("organization_id", context.organizationId)
    .eq("facility_id", facilityId)
    .eq("shift_date", shiftDate)
    .is("deleted_at", null)
    .in("status", ["assigned", "confirmed"]);

  if (assignmentsError) {
    logError("rounding.generate-tasks", assignmentsError, { action: "load_assignments", facilityId, shiftDate });
    return NextResponse.json({ error: "Could not load shift assignments" }, { status: 500 });
  }

  const assignments = (assignmentsData ?? []) as ShiftAssignmentRecord[];

  const { data: rulesData, error: rulesError } = await context.admin
    .from("resident_observation_plan_rules")
    .select(`
      id,
      plan_id,
      interval_type,
      interval_minutes,
      shift,
      daypart_start,
      daypart_end,
      days_of_week,
      grace_minutes,
      required_fields_schema,
      escalation_policy_key,
      sort_order,
      active,
      deleted_at
    `)
    .in("plan_id", planIds)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (rulesError) {
    logError("rounding.generate-tasks", rulesError, { action: "load_rules", planCount: planIds.length });
    return NextResponse.json({ error: "Could not load observation plan rules" }, { status: 500 });
  }

  const { data: watchesData, error: watchesError } = await context.admin
    .from("resident_watch_instances")
    .select("id, resident_id, status")
    .eq("organization_id", context.organizationId)
    .eq("facility_id", facilityId)
    .in("resident_id", residentIds)
    .eq("status", "active")
    .is("deleted_at", null);

  if (watchesError) {
    logError("rounding.generate-tasks", watchesError, { action: "load_watches", facilityId });
    return NextResponse.json({ error: "Could not load resident watch instances" }, { status: 500 });
  }

  const rulesByPlanId = new Map<string, PlanRuleRecord[]>();
  for (const rawRule of (rulesData ?? []) as (PlanRuleRecord & { plan_id: string })[]) {
    const list = rulesByPlanId.get(rawRule.plan_id) ?? [];
    list.push(rawRule);
    rulesByPlanId.set(rawRule.plan_id, list);
  }

  const activeWatchByResidentId = new Map<string, PlanWatchRecord>();
  for (const watch of (watchesData ?? []) as PlanWatchRecord[]) {
    if (!activeWatchByResidentId.has(watch.resident_id)) {
      activeWatchByResidentId.set(watch.resident_id, watch);
    }
  }

  const generated = plans.flatMap((plan, planIndex) => {
    const activeRules = (rulesByPlanId.get(plan.id) ?? []).filter((rule) => !rule.deleted_at && rule.active);
    const activeWatch = activeWatchByResidentId.get(plan.resident_id);
    const assigned = assignments && assignments.length > 0 ? assignments[planIndex % assignments.length] : null;

    return activeRules.flatMap((rule) =>
      generateObservationTasks({
        organizationId: context.organizationId,
        entityId: plan.entity_id ?? null,
        facilityId: plan.facility_id,
        residentId: plan.resident_id,
        planId: plan.id,
        planRuleId: rule.id,
        watchInstanceId: activeWatch?.id ?? null,
        shiftAssignmentId: assigned?.id ?? null,
        assignedStaffId: assigned?.staff_id ?? null,
        windowStart,
        windowEnd,
        rule: {
          intervalType: rule.interval_type,
          intervalMinutes: rule.interval_minutes,
          shift: rule.shift,
          daypartStart: rule.daypart_start,
          daypartEnd: rule.daypart_end,
          daysOfWeek: rule.days_of_week ?? undefined,
          graceMinutes: rule.grace_minutes,
          requiredFieldsSchema: rule.required_fields_schema ?? undefined,
          escalationPolicyKey: rule.escalation_policy_key,
          sortOrder: rule.sort_order,
          active: rule.active,
        } satisfies PlanRuleInput,
      }),
    );
  });

  if (generated.length === 0) {
    return NextResponse.json({ generated: 0, inserted: 0, plans: plans.length });
  }

  const rows = generated.map((task: GeneratedTaskInput) => ({
    organization_id: task.organizationId,
    entity_id: task.entityId ?? null,
    facility_id: task.facilityId,
    resident_id: task.residentId,
    plan_id: task.planId,
    plan_rule_id: task.planRuleId,
    watch_instance_id: task.watchInstanceId ?? null,
    shift_assignment_id: task.shiftAssignmentId ?? null,
    assigned_staff_id: task.assignedStaffId ?? null,
    scheduled_for: task.scheduledFor,
    due_at: task.dueAt,
    grace_ends_at: task.graceEndsAt,
    status: task.status,
    notes: task.notes ?? null,
  }));

  const freshAuth = await revalidateRoundingRequestContext(context, { managerOnly: true, facilityId });
  if ("response" in freshAuth) return freshAuth.response;
  context = freshAuth.context;

  const { data: insertedCount, error: insertError } = await context.admin.rpc(
    "generate_rounding_tasks_review" as never,
    {
      p_rows: rows,
      p_actor_id: context.userId,
      p_actor_role: context.appRole,
      p_session_id: context.sessionId,
      p_claim_version: context.authClaimVersion,
      p_organization_id: context.organizationId,
      p_facility_id: facilityId,
    } as never,
  );

  if (insertError) {
    logError("rounding.generate-tasks", insertError, { action: "insert_tasks", facilityId, rowCount: rows.length });
    return NextResponse.json(
      { error: insertError.code === "42501" ? "No longer authorized to generate tasks" : "Could not create observation tasks" },
      { status: insertError.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({
    generated: generated.length,
    inserted: typeof insertedCount === "number" ? insertedCount : 0,
    plans: plans.length,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  });
}
