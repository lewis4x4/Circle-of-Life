/**
 * GET    /api/admin/facilities/[facilityId]/documents  — List facility documents
 * POST   /api/admin/facilities/[facilityId]/documents  — Upload document with metadata
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { documentMetadataSchema } from "@/lib/validation/facility-admin";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asUntypedAdmin, type UntypedQueryBuilder } from "@/lib/admin/facilities/untyped-admin";
import type { Database } from "@/types/database";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

async function enrichDocumentsWithUploaderLabels(
  admin: SupabaseClient<Database>,
  docs: Record<string, unknown>[],
): Promise<Array<Record<string, unknown>>> {
  const ids = [...new Set(docs.map((d) => d.uploaded_by as string).filter(Boolean))];
  if (ids.length === 0) {
    return docs.map((row) => ({ ...row, uploaded_by_display: undefined }));
  }

  const { data: profiles, error } = await admin.from("user_profiles").select("id, email, full_name").in("id", ids);
  if (error || !profiles) {
    return docs.map((row) => ({
      ...row,
      uploaded_by_display: "Unknown",
    }));
  }

  const map = new Map(
    profiles.map((p: { id: string; email: string; full_name: string }) => [
      p.id,
      formatUploadedByProfile({
        email: p.email,
        full_name: p.full_name,
      }),
    ]),
  );

  return docs.map((row) => ({
    ...row,
    uploaded_by_display:
      typeof row.uploaded_by === "string" ? map.get(row.uploaded_by) ?? "Unknown" : "Unknown",
  }));
}

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── GET: List Documents ───────────────────────────────────────────

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

  const archived = request.nextUrl.searchParams.get("archived") === "1";

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

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffIso = cutoff.toISOString();

  const selectFacilityDocuments = (): UntypedQueryBuilder =>
    untypedAdmin
      .from("facility_documents")
      .select(
        "id, document_category, document_name, friendly_title, carrier, notes, file_path, file_size_bytes, mime_type, expiration_date, alert_yellow_days, alert_red_days, effective_date, uploaded_at, uploaded_by, updated_at, vault_series_id, supersedes_document_id",
      )
      .eq("facility_id", facilityId) as unknown as UntypedQueryBuilder;

  const { data: documents, error } = archived
    ? await selectFacilityDocuments().not("deleted_at", "is", null).gte("deleted_at", cutoffIso).order("uploaded_at", { ascending: false })
    : await selectFacilityDocuments().is("deleted_at", null).order("uploaded_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  }

  const rows = documents ?? [];
  const enriched = await enrichDocumentsWithUploaderLabels(admin, rows as Record<string, unknown>[]);

  return NextResponse.json({
    data: enriched,
  });
}

// ── POST: Upload Document ─────────────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

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

    let vaultSeriesId = documentMetadata.vault_series_id ?? null;
    let superseded: Record<string, unknown> | null = null;

    if (documentMetadata.supersedes_document_id) {
      const { data: oldDoc, error: oldErr } = await untypedAdmin
        .from("facility_documents")
        .select("id, vault_series_id, document_name, file_path, mime_type, file_size_bytes, expiration_date, document_category")
        .eq("id", documentMetadata.supersedes_document_id)
        .eq("facility_id", facilityId)
        .eq("organization_id", actor.organization_id!)
        .is("deleted_at", null)
        .maybeSingle();
      if (oldErr || !oldDoc) {
        return NextResponse.json({ error: "Document to replace not found" }, { status: 404 });
      }
      superseded = oldDoc as Record<string, unknown>;
      vaultSeriesId = (superseded.vault_series_id as string) ?? (superseded.id as string);
    }

    if (!vaultSeriesId) {
      vaultSeriesId = crypto.randomUUID();
    }

    // Upload file to Supabase Storage
    const fileId = crypto.randomUUID();
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

    const nowIso = new Date().toISOString();

    if (superseded) {
      const { data: priorVersions } = await untypedAdmin
        .from("facility_document_versions")
        .select("version_number")
        .eq("vault_series_id", vaultSeriesId);

      const nums =
        priorVersions?.map((p) => {
          const vn = p.version_number;
          return typeof vn === "number" && Number.isFinite(vn) ? vn : 0;
        }) ?? [];
      const vn = Math.max(0, ...nums) + 1;

      const { error: verInsErr } = await untypedAdmin.from("facility_document_versions").insert({
        organization_id: actor.organization_id!,
        facility_id: facilityId,
        superseded_document_id: superseded.id,
        vault_series_id: vaultSeriesId,
        version_number: vn,
        document_name: superseded.document_name,
        file_path: superseded.file_path,
        mime_type: superseded.mime_type,
        file_size_bytes: superseded.file_size_bytes,
        expiration_date: superseded.expiration_date ?? null,
        document_category: superseded.document_category,
        replaced_by: actor.id,
        replaced_at: nowIso,
      } as Record<string, unknown>);

      if (verInsErr) {
        console.error("[document-upload] version ledger error:", verInsErr);
      }

      const { error: softErr } = await untypedAdmin
        .from("facility_documents")
        .update({ deleted_at: nowIso } as Record<string, unknown>)
        .eq("id", superseded.id as string);
      if (softErr) {
        console.error("[document-upload] supersede soft-delete error:", softErr);
      }
    }

    const { data: docRecord, error: insertErr } = await untypedAdmin
      .from("facility_documents")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        document_category: documentMetadata.document_category,
        document_name: documentMetadata.document_name,
        friendly_title: documentMetadata.friendly_title ?? null,
        carrier: documentMetadata.carrier ?? null,
        effective_date: documentMetadata.effective_date ?? null,
        file_path: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
        expiration_date: documentMetadata.expiration_date ?? null,
        alert_yellow_days: documentMetadata.alert_yellow_days,
        alert_red_days: documentMetadata.alert_red_days,
        notes: documentMetadata.notes ?? null,
        uploaded_by: actor.id,
        vault_series_id: vaultSeriesId,
        supersedes_document_id: superseded ? (superseded.id as string) : null,
      } as Record<string, unknown>)
      .select()
      .single();

    if (insertErr) {
      console.error("[document-upload] Insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create document record" }, { status: 500 });
    }

    const [enriched] = await enrichDocumentsWithUploaderLabels(admin, [docRecord as Record<string, unknown>]);

    return NextResponse.json({ data: enriched }, { status: 201 });
  } catch (err) {
    console.error("[document-upload] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
