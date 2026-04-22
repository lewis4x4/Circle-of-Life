import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { OPERATIONS_TEMPLATE_AUTHOR_ROLES } from "@/lib/operations/constants";
import {
  normalizeEscalationLadder,
  normalizeOperationTemplateMutationBody,
  type OperationTemplateMutationPayload,
  type OperationTemplateRecord,
} from "@/lib/operations/templates";

const TEMPLATE_SELECT = `
  id,
  facility_id,
  name,
  description,
  category,
  cadence_type,
  shift_scope,
  day_of_week,
  day_of_month,
  month_of_year,
  assignee_role,
  required_role_fallback,
  escalation_ladder,
  asset_ref,
  vendor_booking_ref,
  linked_document_id,
  priority,
  license_threatening,
  compliance_requirement,
  survey_readiness_impact,
  requires_dual_sign,
  estimated_minutes,
  auto_complete_after_hours,
  is_active,
  version,
  previous_version_id,
  created_at,
  updated_at
`;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApiActor({ allowedRoles: OPERATIONS_TEMPLATE_AUTHOR_ROLES });
  if ("response" in auth) return auth.response;

  const { actor } = auth;
  const { id } = await context.params;
  const body = (await request.json()) as OperationTemplateMutationPayload;

  const { data: existingData, error: existingError } = await actor.admin
    .from("operation_task_templates" as never)
    .select(TEMPLATE_SELECT)
    .eq("organization_id", actor.organization_id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existing = existingData as unknown as OperationTemplateRecord | null;
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  if (existing.facility_id && !(await actorCanAccessFacility(actor, existing.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const changingOnlyStatus =
    Object.keys(body).length > 0 &&
    Object.keys(body).every((key) => key === "is_active") &&
    typeof body.is_active === "boolean";

  if (changingOnlyStatus) {
    const { data, error } = await actor.admin
      .from("operation_task_templates" as never)
      .update({
        is_active: body.is_active,
        updated_by: actor.id,
      } as never)
      .eq("organization_id", actor.organization_id)
      .eq("id", id)
      .select(TEMPLATE_SELECT)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      template: {
        ...(data as object),
        escalation_ladder: normalizeEscalationLadder((data as OperationTemplateRecord).escalation_ladder),
      },
      versioned: false,
    });
  }

  const normalized = normalizeOperationTemplateMutationBody({
    facility_id: body.facility_id ?? existing.facility_id,
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    category: body.category ?? existing.category,
    cadence_type: body.cadence_type ?? existing.cadence_type,
    shift_scope: body.shift_scope ?? existing.shift_scope,
    day_of_week: body.day_of_week ?? existing.day_of_week,
    day_of_month: body.day_of_month ?? existing.day_of_month,
    month_of_year: body.month_of_year ?? existing.month_of_year,
    assignee_role: body.assignee_role ?? existing.assignee_role,
    required_role_fallback: body.required_role_fallback ?? existing.required_role_fallback,
    escalation_ladder: body.escalation_ladder ?? existing.escalation_ladder,
    asset_ref: body.asset_ref ?? existing.asset_ref,
    vendor_booking_ref: body.vendor_booking_ref ?? existing.vendor_booking_ref,
    linked_document_id: body.linked_document_id ?? existing.linked_document_id,
    priority: body.priority ?? existing.priority,
    license_threatening: body.license_threatening ?? existing.license_threatening,
    compliance_requirement: body.compliance_requirement ?? existing.compliance_requirement,
    survey_readiness_impact: body.survey_readiness_impact ?? existing.survey_readiness_impact,
    requires_dual_sign: body.requires_dual_sign ?? existing.requires_dual_sign,
    estimated_minutes: body.estimated_minutes ?? existing.estimated_minutes,
    auto_complete_after_hours: body.auto_complete_after_hours ?? existing.auto_complete_after_hours,
    is_active: body.is_active ?? existing.is_active,
  });
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  if (normalized.facility_id && !(await actorCanAccessFacility(actor, normalized.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await actor.admin
    .from("operation_task_templates" as never)
    .insert({
      organization_id: actor.organization_id,
      ...normalized,
      version: (existing.version ?? 1) + 1,
      previous_version_id: existing.id,
      created_by: actor.id,
      updated_by: actor.id,
    } as never)
    .select(TEMPLATE_SELECT)
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: deactivateError } = await actor.admin
    .from("operation_task_templates" as never)
    .update({
      is_active: false,
      updated_by: actor.id,
    } as never)
    .eq("organization_id", actor.organization_id)
    .eq("id", existing.id);

  if (deactivateError) {
    return NextResponse.json({ error: deactivateError.message }, { status: 500 });
  }

  return NextResponse.json({
    template: {
      ...(inserted as object),
      escalation_ladder: normalizeEscalationLadder((inserted as OperationTemplateRecord).escalation_ladder),
    },
    versioned: true,
    previous_template_id: existing.id,
  });
}
