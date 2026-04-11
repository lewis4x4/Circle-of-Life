/**
 * GET /api/admin/facilities/[facilityId]/vendors — Vendors linked to this facility (vendor_facilities + vendors).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return profile ? { ...profile, admin } : null;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;
  const admin = actor.admin;

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
  if (vendorIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { data: vendors, error: vErr } = await admin
    .from("vendors")
    .select(
      "id, name, category, status, primary_contact_name, primary_contact_phone, primary_contact_email, notes",
    )
    .in("id", vendorIds)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

  if (vErr) {
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }

  const vendorMap = new Map((vendors ?? []).map((v) => [v.id, v]));
  const data = (links ?? []).map((link) => ({
    ...link,
    vendor: vendorMap.get(link.vendor_id) ?? null,
  }));

  return NextResponse.json({ data });
}
