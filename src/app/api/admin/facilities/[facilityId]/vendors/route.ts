/**
 * GET /api/admin/facilities/[facilityId]/vendors — Vendors linked to this facility (vendor_facilities + vendors).
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: links, error: linkErr } = await admin
    .from("vendor_facilities")
    .select("id, vendor_id, is_primary, created_at")
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

  if (linkErr) {
    return NextResponse.json({ error: "Failed to fetch vendor links" }, { status: 500 });
  }

  const vendorIds = [...new Set((links ?? []).map((l) => l.vendor_id))];
  const { data: vendors, error: vErr } = vendorIds.length > 0
    ? await admin
      .from("vendors")
      .select(
        "id, name, category, status, primary_contact_name, primary_contact_phone, primary_contact_email, notes",
      )
      .in("id", vendorIds)
      .eq("organization_id", actor.organization_id!)
      .is("deleted_at", null)
    : { data: [], error: null };

  if (vErr) {
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }

  const vendorMap = new Map((vendors ?? []).map((v) => [v.id, v]));
  const linkedRows = (links ?? []).map((link) => ({
    ...link,
    vendor: vendorMap.get(link.vendor_id) ?? null,
  }));

  const linkedKeys = new Set(
    linkedRows.map((row) => {
      const vendor = row.vendor;
      return [vendor?.name ?? "", vendor?.category ?? "", vendor?.primary_contact_phone ?? ""].join("|");
    }),
  );

  // Facility Launch M18 currently promotes source-backed vendor summaries into
  // facility_vendors. The operational AP vendor directory still uses
  // vendors/vendor_facilities. Surface the launch-imported rows here so the
  // facility tab reflects uploaded onboarding data without inventing canonical
  // AP vendor records prematurely.
  const { data: launchVendors, error: launchErr } = await untypedAdmin
    .from("facility_vendors")
    .select("id, organization, category, primary_contact, phone, after_hours_phone, contract_status, insurance_required, escalation_owner, created_at")
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

  if (launchErr) {
    return NextResponse.json({ error: "Failed to fetch facility launch vendors" }, { status: 500 });
  }

  const launchRows = (launchVendors ?? [])
    .filter((row) => !linkedKeys.has([row.organization ?? "", row.category ?? "", row.phone ?? ""].join("|")))
    .map((row) => ({
      id: `facility-launch-${row.id}`,
      vendor_id: null,
      is_primary: false,
      created_at: row.created_at,
      source: "facility_launch",
      vendor: {
        id: "",
        name: row.organization,
        category: row.category ?? "other",
        status: "launch_imported",
        primary_contact_name: row.primary_contact,
        primary_contact_phone: row.phone ?? row.after_hours_phone,
        primary_contact_email: null,
        notes: [
          row.contract_status ? `Contract: ${row.contract_status}` : null,
          row.insurance_required ? `Insurance: ${row.insurance_required}` : null,
          row.escalation_owner ? `Escalation: ${row.escalation_owner}` : null,
        ].filter(Boolean).join(" · ") || "Imported from Facility Launch M18; not yet normalized into the AP vendor directory.",
      },
    }));

  return NextResponse.json({ data: [...linkedRows, ...launchRows] });
}
