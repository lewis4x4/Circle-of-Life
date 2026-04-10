/**
 * GET    /api/admin/facilities/[facilityId]/documents  — List facility documents
 * POST   /api/admin/facilities/[facilityId]/documents  — Upload document with metadata
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { documentMetadataSchema } from "@/lib/validation/facility-admin";
import { v4 as uuidv4 } from "uuid";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── Helper: authenticate + get actor ──────────────────────────────

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

// ── GET: List Documents ───────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;
  const admin = actor.admin;

  // Verify facility exists and belongs to org
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

  // List documents ordered by uploaded_at desc
  const { data: documents, error } = await admin
    .from("facility_documents")
    .select(
      "id, document_category, document_name, file_path, file_size_bytes, mime_type, expiration_date, alert_yellow_days, alert_red_days, notes, uploaded_at, uploaded_by, updated_at",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  }

  return NextResponse.json({
    data: documents ?? [],
  });
}

// ── POST: Upload Document ─────────────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;

  // Authorization: owner/org_admin only
  if (!["owner", "org_admin"].includes(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const admin = actor.admin;

  // Verify facility exists and belongs to org
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

  try {
    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const metadataStr = formData.get("metadata") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!metadataStr) {
      return NextResponse.json({ error: "No metadata provided" }, { status: 400 });
    }

    let metadata;
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      return NextResponse.json({ error: "Invalid metadata JSON" }, { status: 400 });
    }

    const metadataParsed = documentMetadataSchema.safeParse(metadata);
    if (!metadataParsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: metadataParsed.error.flatten() },
        { status: 422 },
      );
    }

    const documentMetadata = metadataParsed.data;

    // Upload file to Supabase Storage
    const fileId = uuidv4();
    const storagePath = `${facilityId}/${fileId}/${file.name}`;

    const buffer = await file.arrayBuffer();
    const { error: uploadErr } = await admin.storage
      .from("facility-documents")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
      });

    if (uploadErr) {
      console.error("[document-upload] Storage error:", uploadErr);
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
    }

    // Create metadata record
    const { data: docRecord, error: insertErr } = await admin
      .from("facility_documents")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        document_category: documentMetadata.document_category,
        document_name: documentMetadata.document_name,
        file_path: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
        expiration_date: documentMetadata.expiration_date ?? null,
        alert_yellow_days: documentMetadata.alert_yellow_days,
        alert_red_days: documentMetadata.alert_red_days,
        notes: documentMetadata.notes ?? null,
        uploaded_by: actor.id,
      } as any)
      .select()
      .single() as any;

    if (insertErr) {
      console.error("[document-upload] Insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create document record" }, { status: 500 });
    }

    return NextResponse.json({ data: docRecord }, { status: 201 });
  } catch (err) {
    console.error("[document-upload] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
