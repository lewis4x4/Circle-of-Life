/**
 * GET /api/admin/facilities/[facilityId]/documents/[documentId]/signed-url — Short-lived read URL for in-app preview/download.
 */

import { NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string; documentId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId, documentId } = await ctx.params;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: doc, error } = await untypedAdmin
    .from("facility_documents")
    .select("id, file_path, deleted_at")
    .eq("id", documentId)
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .maybeSingle();

  if (error || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (doc.deleted_at != null) {
    return NextResponse.json({ error: "Document archived" }, { status: 410 });
  }

  const path = doc.file_path as string;
  const { data: signed, error: signErr } = await admin.storage
    .from("facility-documents")
    .createSignedUrl(path, 120);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "Failed to sign file URL" }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: signed.signedUrl });
}
