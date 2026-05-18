/**
 * GET — Vendors linked to this facility (vendor_facilities + vendors)
 * POST — Link vendor to facility (`vendor_facilities`)
 * GET `?mode=catalog&q=` — Org vendors excluding active facility links for link modal search
 */

import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
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

  const url = request.nextUrl;
  const catalogMode = url.searchParams.get("mode") === "catalog";
  const search = (url.searchParams.get("q") ?? "").trim();

  if (catalogMode) {
    const { data: linkRows } = await admin
      .from("vendor_facilities")
      .select("vendor_id")
      .eq("facility_id", facilityId)
      .eq("organization_id", actor.organization_id!)
      .is("deleted_at", null);

    const linked = new Set((linkRows ?? []).map((l) => l.vendor_id as string));

    let qb = admin
      .from("vendors")
      .select(
        "id, name, category, status, primary_contact_name, primary_contact_phone, primary_contact_email, notes",
      )
      .eq("organization_id", actor.organization_id!)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("name");

    if (search.length) {
      qb = qb.ilike("name", `%${search}%`);
    }

    const { data: allVendors, error: catErr } = await qb.limit(250);

    if (catErr) {
      return NextResponse.json({ error: catErr.message }, { status: 500 });
    }

    const filtered = ((allVendors ?? []) as { id: string }[]).filter((v) => !linked.has(v.id));
    return NextResponse.json({ catalog: filtered });
  }

  const { data: links, error: linkErr } = await admin
    .from("vendor_facilities")
    .select(
      "id, vendor_id, is_primary, created_at, coi_on_file, coi_expiration, service_contract_status, service_contract_expiration, last_invoice_at, last_payment_at",
    )
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null);

  if (linkErr) {
    return NextResponse.json({ error: "Failed to fetch vendor links" }, { status: 500 });
  }

  const vendorIds = [...new Set((links ?? []).map((l) => l.vendor_id))];
  const { data: vendors, error: vErr } =
    vendorIds.length > 0
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
    ...(link as Record<string, unknown>),
    vendor: vendorMap.get(link.vendor_id as string) ?? null,
  }));

  const canonical_vendor_count = linkedRows.length;

  const linkedKeys = new Set(
    linkedRows.map((row) => {
      const vendor = row.vendor as { name?: string; category?: string; primary_contact_phone?: string | null } | null;
      return [vendor?.name ?? "", vendor?.category ?? "", vendor?.primary_contact_phone ?? ""].join("|");
    }),
  );

  const { data: launchVendors, error: launchErr } = await untypedAdmin
    .from("facility_vendors")
    .select(
      "id, organization, category, primary_contact, phone, after_hours_phone, contract_status, insurance_required, escalation_owner, created_at",
    )
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
      coi_on_file: null,
      coi_expiration: null,
      service_contract_status: null,
      service_contract_expiration: null,
      last_invoice_at: null,
      last_payment_at: null,
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
        ].filter(Boolean).join(" · ") ||
          "Imported from Facility Launch M18; not yet normalized into the AP vendor directory.",
      },
    }));

  return NextResponse.json({
    data: [...linkedRows, ...launchRows],
    kpi: {
      canonical_vendor_count,
      migration_residue_count: launchRows.length,
    },
  });
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  let vendorId: unknown;
  try {
    vendorId = (await request.json() as Record<string, unknown>).vendor_id;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof vendorId !== "string" || vendorId.length < 10) {
    return NextResponse.json({ error: "vendor_id required" }, { status: 400 });
  }

  const { data: existingRow } = await actor.admin
    .from("vendor_facilities")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("vendor_id", vendorId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingRow?.id) {
    return NextResponse.json({ ok: true, id: existingRow.id });
  }

  const { data: inserted, error: insErr } = await actor.admin
    .from("vendor_facilities")
    .insert({
      organization_id: actor.organization_id!,
      facility_id: facilityId,
      vendor_id: vendorId,
      is_primary: false,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}
