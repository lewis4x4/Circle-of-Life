import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { OPERATIONS_TEMPLATE_AUTHOR_ROLES } from "@/lib/operations/constants";
import {
  isOceCadenceType,
  isOperationTemplateCategory,
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

type FacilityNameRow = { id: string; name: string };
type AssetNameRow = { id: string; name: string };
type VendorNameRow = { id: string; name: string };

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: OPERATIONS_TEMPLATE_AUTHOR_ROLES });
  if ("response" in auth) return auth.response;

  const { actor } = auth;
  const facilityId = request.nextUrl.searchParams.get("facility_id");
  const category = request.nextUrl.searchParams.get("category");
  const cadence = request.nextUrl.searchParams.get("cadence");
  const status = request.nextUrl.searchParams.get("status") ?? "active";
  const scope = request.nextUrl.searchParams.get("scope") ?? "all";

  if (facilityId && !(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  if (category && !isOperationTemplateCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (cadence && !isOceCadenceType(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
  }
  if (!["all", "active", "inactive"].includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  if (!["all", "org", "facility"].includes(scope)) {
    return NextResponse.json({ error: "Invalid scope filter" }, { status: 400 });
  }

  let query = auth.actor.admin
    .from("operation_task_templates" as never)
    .select(TEMPLATE_SELECT)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (cadence) query = query.eq("cadence_type", cadence);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  if (scope === "org") {
    query = query.is("facility_id", null);
  } else if (scope === "facility") {
    query = facilityId ? query.eq("facility_id", facilityId) : query.not("facility_id", "is", null);
  } else if (facilityId) {
    query = query.or(`facility_id.is.null,facility_id.eq.${facilityId}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const templates = (data ?? []) as unknown as OperationTemplateRecord[];
  const facilityIds = Array.from(new Set(templates.map((template) => template.facility_id).filter(Boolean))) as string[];
  const assetIds = Array.from(new Set(templates.map((template) => template.asset_ref).filter(Boolean))) as string[];
  const vendorIds = Array.from(new Set(templates.map((template) => template.vendor_booking_ref).filter(Boolean))) as string[];

  const [facilityResult, assetResult, vendorResult] = await Promise.all([
    facilityIds.length > 0
      ? actor.admin
          .from("facilities")
          .select("id, name")
          .in("id", facilityIds)
          .eq("organization_id", actor.organization_id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as FacilityNameRow[] }),
    assetIds.length > 0
      ? actor.admin
          .from("facility_assets" as never)
          .select("id, name")
          .in("id", assetIds)
          .eq("organization_id", actor.organization_id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as AssetNameRow[] }),
    vendorIds.length > 0
      ? actor.admin
          .from("vendors" as never)
          .select("id, name")
          .in("id", vendorIds)
          .eq("organization_id", actor.organization_id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as VendorNameRow[] }),
  ]);

  const facilityNameMap = new Map((facilityResult.data ?? []).map((facility) => [facility.id, facility.name]));
  const assetNameMap = new Map(((assetResult.data ?? []) as unknown as AssetNameRow[]).map((asset) => [asset.id, asset.name]));
  const vendorNameMap = new Map(
    ((vendorResult.data ?? []) as unknown as VendorNameRow[]).map((vendor) => [vendor.id, vendor.name]),
  );

  return NextResponse.json({
    templates: templates.map((template) => ({
      ...template,
      escalation_ladder: normalizeEscalationLadder(template.escalation_ladder),
      facility_name: template.facility_id ? facilityNameMap.get(template.facility_id) ?? null : null,
      asset_name: template.asset_ref ? assetNameMap.get(template.asset_ref) ?? null : null,
      vendor_name: template.vendor_booking_ref ? vendorNameMap.get(template.vendor_booking_ref) ?? null : null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: OPERATIONS_TEMPLATE_AUTHOR_ROLES });
  if ("response" in auth) return auth.response;

  const { actor } = auth;
  const body = (await request.json()) as OperationTemplateMutationPayload;
  const normalized = normalizeOperationTemplateMutationBody(body);
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  if (normalized.facility_id && !(await actorCanAccessFacility(actor, normalized.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data, error } = await actor.admin
    .from("operation_task_templates" as never)
    .insert({
      organization_id: actor.organization_id,
      ...normalized,
      version: 1,
      previous_version_id: null,
      created_by: actor.id,
      updated_by: actor.id,
    } as never)
    .select(TEMPLATE_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}
