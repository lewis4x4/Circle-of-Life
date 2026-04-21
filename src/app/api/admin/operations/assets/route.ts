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

type AssetRow = {
  id: string;
  facility_id: string;
  organization_id: string;
  asset_type: string;
  asset_tag: string | null;
  serial_number: string | null;
  name: string;
  description: string | null;
  manufacturer: string | null;
  model: string | null;
  year_manufactured: number | null;
  install_date: string | null;
  install_location: string | null;
  warranty_end_date: string | null;
  service_interval_days: number | null;
  last_service_at: string | null;
  last_service_vendor_id: string | null;
  next_service_due_at: string | null;
  service_notes: string | null;
  lifecycle_replace_by: string | null;
  replacement_cost_estimate_cents: number | null;
  replacement_justification: string | null;
  status: string;
};

type VendorNameRow = { id: string; name: string };
type TemplateSummaryRow = { id: string; asset_ref: string | null };

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

  const { data: assetData, error: assetError } = await actor.admin
    .from("facility_assets" as never)
    .select("*")
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null)
    .order("next_service_due_at", { ascending: true });

  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 });
  }

  const assets = (assetData ?? []) as unknown as AssetRow[];
  const vendorIds = Array.from(new Set(assets.map((asset) => asset.last_service_vendor_id).filter(Boolean))) as string[];
  const assetIds = assets.map((asset) => asset.id);

  const [{ data: vendorData }, { data: templateData }] = await Promise.all([
    vendorIds.length > 0
      ? actor.admin
          .from("vendors")
          .select("id, name")
          .in("id", vendorIds)
          .eq("organization_id", actor.organization_id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as VendorNameRow[] }),
    assetIds.length > 0
      ? actor.admin
          .from("operation_task_templates" as never)
          .select("id, asset_ref")
          .in("asset_ref", assetIds)
          .eq("organization_id", actor.organization_id)
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as TemplateSummaryRow[] }),
  ]);

  const vendorMap = new Map((vendorData ?? []).map((vendor) => [vendor.id, vendor.name]));
  const templateCounts = new Map<string, number>();
  for (const template of ((templateData ?? []) as unknown as TemplateSummaryRow[])) {
    if (!template.asset_ref) continue;
    templateCounts.set(template.asset_ref, (templateCounts.get(template.asset_ref) ?? 0) + 1);
  }

  return NextResponse.json({
    assets: assets.map((asset) => ({
      ...asset,
      last_service_vendor_name: asset.last_service_vendor_id ? vendorMap.get(asset.last_service_vendor_id) ?? null : null,
      linked_template_count: templateCounts.get(asset.id) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  if (!MANAGE_ROLES.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await request.json()) as Partial<AssetRow>;
  if (!body.facility_id || !body.name || !body.asset_type) {
    return NextResponse.json({ error: "facility_id, name, and asset_type are required" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(actor, body.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data, error } = await actor.admin
    .from("facility_assets" as never)
    .insert({
      organization_id: actor.organization_id,
      facility_id: body.facility_id,
      asset_type: body.asset_type,
      asset_tag: body.asset_tag ?? null,
      serial_number: body.serial_number ?? null,
      name: body.name,
      description: body.description ?? null,
      manufacturer: body.manufacturer ?? null,
      model: body.model ?? null,
      year_manufactured: body.year_manufactured ?? null,
      install_date: body.install_date ?? null,
      install_location: body.install_location ?? null,
      warranty_end_date: body.warranty_end_date ?? null,
      service_interval_days: body.service_interval_days ?? null,
      last_service_at: body.last_service_at ?? null,
      last_service_vendor_id: body.last_service_vendor_id ?? null,
      next_service_due_at: body.next_service_due_at ?? null,
      service_notes: body.service_notes ?? null,
      lifecycle_replace_by: body.lifecycle_replace_by ?? null,
      replacement_cost_estimate_cents: body.replacement_cost_estimate_cents ?? null,
      replacement_justification: body.replacement_justification ?? null,
      status: body.status ?? "active",
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
