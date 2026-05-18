import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import { validateObservationPlanPayload } from "@/lib/rounding/observation-plan-validation";
import type { ObservationPlanInput } from "@/lib/rounding/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();
  const residentId = searchParams.get("residentId")?.trim();
  const planId = searchParams.get("planId")?.trim();

  if (!facilityId && !planId) {
    return NextResponse.json({ error: "facilityId or planId is required" }, { status: 400 });
  }

  if (facilityId) {
    const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
    if (!hasAccess) {
      return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
    }
  }

  let query = context.admin
    .from("resident_observation_plans")
    .select(`
      *,
      resident_observation_plan_rules(*),
      residents(id, first_name, last_name, preferred_name)
    `)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .order("effective_from", { ascending: false });

  if (planId) {
    query = query.eq("id", planId);
  }
  if (facilityId) {
    query = query.eq("facility_id", facilityId);
  }
  if (residentId) {
    query = query.eq("resident_id", residentId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[rounding/plans] get", error);
    return NextResponse.json({ error: "Could not load observation plans" }, { status: 500 });
  }

  const plans = data ?? [];

  const facilityIdsToCheck = [...new Set(plans.map((p) => p.facility_id as string))];
  for (const fid of facilityIdsToCheck) {
    const hasAccess = await assertRoundingFacilityAccess(context, fid);
    if (!hasAccess) {
      return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
    }
  }

  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can manage plans" }, { status: 403 });
  }

  let body: ObservationPlanInput;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "JSON body must be an object" }, { status: 400 });
    }
    body = parsed as ObservationPlanInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationErrors = validateObservationPlanPayload(body);
  if (!body.facilityId || validationErrors.length > 0) {
    const details = [!body.facilityId ? "facilityId is required." : null, ...validationErrors]
      .filter(Boolean)
      .join(" ");
    return NextResponse.json({ error: details }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, body.facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await context.admin
    .from("facilities")
    .select("entity_id")
    .eq("id", body.facilityId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: resident, error: residentError } = await context.admin
    .from("residents")
    .select("id")
    .eq("id", body.residentId)
    .eq("facility_id", body.facilityId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (residentError || !resident) {
    return NextResponse.json({ error: "residentId must belong to the selected facility" }, { status: 400 });
  }

  const now = new Date().toISOString();
  let planId = body.id?.trim() || null;
  let createdPlanInRequest = false;
  let replacedExistingRules = false;
  const planPayload = {
    organization_id: context.organizationId,
    entity_id: body.entityId ?? facility.entity_id ?? null,
    facility_id: body.facilityId,
    resident_id: body.residentId,
    status: body.status ?? "draft",
    source_type: body.sourceType ?? "manual",
    effective_from: body.effectiveFrom ?? now,
    effective_to: body.effectiveTo ?? null,
    rationale: body.rationale?.trim() ?? "",
  };

  if (planId) {
    const { data: existingPlan, error: existingPlanError } = await context.admin
      .from("resident_observation_plans")
      .select("facility_id")
      .eq("id", planId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingPlanError || !existingPlan) {
      return NextResponse.json({ error: "Observation plan not found" }, { status: 404 });
    }

    if (existingPlan.facility_id !== body.facilityId) {
      return NextResponse.json({ error: "Cannot move plan to a different facility" }, { status: 403 });
    }

    const { error: updateError } = await context.admin
      .from("resident_observation_plans")
      .update(planPayload)
      .eq("id", planId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null);

    if (updateError) {
      console.error("[rounding/plans] update", updateError);
      return NextResponse.json({ error: "Could not update observation plan" }, { status: 500 });
    }

    const { error: ruleDeleteError } = await context.admin
      .from("resident_observation_plan_rules")
      .update({ deleted_at: now })
      .eq("plan_id", planId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null);

    if (ruleDeleteError) {
      console.error("[rounding/plans] soft-delete rules", ruleDeleteError);
      return NextResponse.json({ error: "Could not replace plan rules" }, { status: 500 });
    }
    replacedExistingRules = true;
  } else {
    const { data: createdPlan, error: insertError } = await context.admin
      .from("resident_observation_plans")
      .insert(planPayload)
      .select("id")
      .single();

    if (insertError || !createdPlan) {
      console.error("[rounding/plans] insert", insertError);
      return NextResponse.json({ error: "Could not create observation plan" }, { status: 500 });
    }

    planId = createdPlan.id;
    createdPlanInRequest = true;
  }

  const rulesPayload = body.rules.map((rule, index) => ({
    plan_id: planId,
    organization_id: context.organizationId,
    entity_id: body.entityId ?? facility.entity_id ?? null,
    facility_id: body.facilityId,
    resident_id: body.residentId,
    interval_type: rule.intervalType,
    interval_minutes: rule.intervalMinutes ?? null,
    shift: rule.shift ?? null,
    daypart_start: rule.daypartStart ?? null,
    daypart_end: rule.daypartEnd ?? null,
    days_of_week: rule.daysOfWeek ?? [],
    grace_minutes: rule.graceMinutes ?? 15,
    required_fields_schema: rule.requiredFieldsSchema ?? {},
    escalation_policy_key: rule.escalationPolicyKey ?? null,
    sort_order: rule.sortOrder ?? index,
    active: rule.active ?? true,
  }));

  const { error: rulesInsertError } = await context.admin
    .from("resident_observation_plan_rules")
    .insert(rulesPayload as never);

  if (rulesInsertError) {
    console.error("[rounding/plans] insert rules", rulesInsertError);
    if (createdPlanInRequest) {
      const { error: rollbackPlanError } = await context.admin
        .from("resident_observation_plans")
        .update({ deleted_at: now })
        .eq("id", planId)
        .eq("organization_id", context.organizationId);
      if (rollbackPlanError) console.error("[rounding/plans] rollback created plan", rollbackPlanError);
    } else if (replacedExistingRules) {
      const { error: restoreRulesError } = await context.admin
        .from("resident_observation_plan_rules")
        .update({ deleted_at: null })
        .eq("plan_id", planId)
        .eq("organization_id", context.organizationId)
        .eq("deleted_at", now);
      if (restoreRulesError) console.error("[rounding/plans] restore replaced rules", restoreRulesError);
    }
    return NextResponse.json({ error: "Could not save observation plan rules" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, planId });
}
