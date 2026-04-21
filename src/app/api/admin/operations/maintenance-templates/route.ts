import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import type { AppRole } from "@/lib/rbac";

const VIEW_ROLES: readonly AppRole[] = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "dietary",
  "maintenance_role",
];

const MANAGE_ROLES = new Set<AppRole>(["owner", "org_admin", "facility_admin", "manager", "maintenance_role"]);

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  cadence_type: string;
  shift_scope: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  assignee_role: string | null;
  priority: string;
  estimated_minutes: number | null;
  asset_ref: string | null;
  vendor_booking_ref: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const facilityId = request.nextUrl.searchParams.get("facility_id");
  if (!facilityId) {
    return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  let query = actor.admin
    .from("operation_task_templates" as never)
    .select("id, name, description, category, cadence_type, shift_scope, day_of_week, day_of_month, month_of_year, assignee_role, priority, estimated_minutes, asset_ref, vendor_booking_ref")
    .eq("organization_id", actor.organization_id)
    .eq("facility_id", facilityId)
    .in("category", ["maintenance", "vendor_management"])
    .is("deleted_at", null)
    .order("name");

  const assetId = request.nextUrl.searchParams.get("asset_id");
  const vendorId = request.nextUrl.searchParams.get("vendor_id");
  if (assetId) query = query.eq("asset_ref", assetId);
  if (vendorId) query = query.eq("vendor_booking_ref", vendorId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: (data ?? []) as unknown as TemplateRow[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  if (!MANAGE_ROLES.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await request.json()) as Partial<TemplateRow> & { facility_id?: string };
  if (!body.facility_id || !body.name || !body.description || !body.category || !body.cadence_type) {
    return NextResponse.json({ error: "facility_id, name, description, category, and cadence_type are required" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(actor, body.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data, error } = await actor.admin
    .from("operation_task_templates" as never)
    .insert({
      organization_id: actor.organization_id,
      facility_id: body.facility_id,
      name: body.name,
      description: body.description,
      category: body.category,
      cadence_type: body.cadence_type,
      shift_scope: body.shift_scope ?? null,
      day_of_week: body.day_of_week ?? null,
      day_of_month: body.day_of_month ?? null,
      month_of_year: body.month_of_year ?? null,
      assignee_role: body.assignee_role ?? "maintenance",
      escalation_ladder: [],
      priority: body.priority ?? "normal",
      estimated_minutes: body.estimated_minutes ?? null,
      asset_ref: body.asset_ref ?? null,
      vendor_booking_ref: body.vendor_booking_ref ?? null,
      created_by: actor.id,
      updated_by: actor.id,
    } as never)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: (data as { id: string }).id });
}
