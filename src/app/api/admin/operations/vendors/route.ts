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

type FacilityVendorLink = {
  vendor_id: string;
  is_primary: boolean;
};

type VendorRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  notes: string | null;
  accepts_bookings: boolean | null;
  booking_confirmation_days_required: number | null;
};

type TemplateSummaryRow = {
  id: string;
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

  const { data: linksData, error: linksError } = await actor.admin
    .from("vendor_facilities")
    .select("vendor_id, is_primary")
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null);

  if (linksError) {
    return NextResponse.json({ error: linksError.message }, { status: 500 });
  }

  const links = (linksData ?? []) as FacilityVendorLink[];
  const vendorIds = links.map((link) => link.vendor_id);
  if (vendorIds.length === 0) {
    return NextResponse.json({ vendors: [] });
  }

  const [{ data: vendorsData, error: vendorsError }, { data: templateData }] = await Promise.all([
    actor.admin
      .from("vendors" as never)
      .select("id, name, category, status, primary_contact_name, primary_contact_phone, primary_contact_email, notes, accepts_bookings, booking_confirmation_days_required")
      .in("id", vendorIds)
      .eq("organization_id", actor.organization_id)
      .is("deleted_at", null),
    actor.admin
      .from("operation_task_templates" as never)
      .select("id, vendor_booking_ref")
      .in("vendor_booking_ref", vendorIds)
      .eq("organization_id", actor.organization_id)
      .eq("facility_id", facilityId)
      .is("deleted_at", null),
  ]);

  if (vendorsError) {
    return NextResponse.json({ error: vendorsError.message }, { status: 500 });
  }

  const templateCounts = new Map<string, number>();
  for (const template of ((templateData ?? []) as unknown as TemplateSummaryRow[])) {
    if (!template.vendor_booking_ref) continue;
    templateCounts.set(template.vendor_booking_ref, (templateCounts.get(template.vendor_booking_ref) ?? 0) + 1);
  }
  const primaryMap = new Map(links.map((link) => [link.vendor_id, link.is_primary]));

  return NextResponse.json({
    vendors: ((vendorsData ?? []) as unknown as VendorRow[]).map((vendor) => ({
      ...vendor,
      is_primary: primaryMap.get(vendor.id) ?? false,
      linked_template_count: templateCounts.get(vendor.id) ?? 0,
    })),
  });
}
