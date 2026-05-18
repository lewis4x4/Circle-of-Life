/**
 * DELETE /api/admin/facilities/[facilityId]/documents/[documentId] — Soft-delete (30-day archive window).
 */

import { NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string; documentId: string }>;
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId, documentId } = await ctx.params;
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const untypedAdmin = asUntypedAdmin(actor.admin);

  const { data: row } = await untypedAdmin
    .from("facility_documents")
    .select("id")
    .eq("id", documentId)
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  const { error } = await untypedAdmin
    .from("facility_documents")
    .update({ deleted_at: now } as Record<string, unknown>)
    .eq("id", documentId);

  if (error) {
    return NextResponse.json({ error: "Failed to archive document" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
