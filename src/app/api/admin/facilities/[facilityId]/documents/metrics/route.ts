/**
 * GET /api/admin/facilities/[facilityId]/documents/metrics — Aggregates for FacilityHeader KPI strip.
 */

import { NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { computeDocumentVaultKpi, type VaultDocSlice } from "@/lib/admin/facilities/document-vault-kpi";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
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
    .select("id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: rows, error } = await untypedAdmin
    .from("facility_documents")
    .select("document_category, expiration_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: "Failed to load document metrics" }, { status: 500 });
  }

  const kpi = computeDocumentVaultKpi((rows ?? []) as VaultDocSlice[]);
  return NextResponse.json({ data: kpi });
}
