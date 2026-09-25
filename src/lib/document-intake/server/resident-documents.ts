/**
 * The resident record's filed documents (where a resident filing opens from).
 * RLS on residents decides who may see the resident; the service client then
 * reads that resident's current documents and streams one inline under the no-script document CSP.
 */
import { z } from "zod";

import type { CurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { requireDocumentIntakeActor, RESIDENT_DOCUMENT_ROLES } from "./actor";
import { sniffDocumentIntakeMime } from "./bytes";
import { intakeFailure, intakeJson, safeInlineBytes } from "./http";
import { downloadObject } from "./storage";

const uuid = z.string().uuid();

// resident_documents rows are insertable under RLS, so the bucket they name is
// never trusted blindly: only the buckets resident documents are stored in.
const RESIDENT_DOCUMENT_BUCKETS = new Set(["resident-documents", "resident-intake-sources"]);

async function visibleResident(actor: CurrentApiActor, residentId: string) {
  const { data, error } = await actor.client
    .from("residents")
    .select("id, facility_id")
    .eq("id", residentId)
    .maybeSingle();
  if (error) {
    logError("resident-documents.resident", error, { residentId });
    return { response: intakeFailure(503, "retryable", "Could not load the resident; try again") } as const;
  }
  if (!data) return { response: intakeFailure(404, "missing", "Resident not found") } as const;
  return { resident: data as { id: string; facility_id: string } } as const;
}

export async function listResidentDocuments(residentId: string) {
  const auth = await requireDocumentIntakeActor(RESIDENT_DOCUMENT_ROLES);
  if ("response" in auth) return auth.response;
  if (!uuid.safeParse(residentId).success) return intakeFailure(404, "missing", "Resident not found");
  const { actor } = auth;
  const resident = await visibleResident(actor, residentId);
  if ("response" in resident) return resident.response;

  const { data, error } = await actor.admin
    .from("resident_documents" as never)
    .select("id, title, document_type, uploaded_at, file_type, file_size, expiration_date, storage_bucket")
    .eq("resident_id", residentId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) {
    logError("resident-documents.list", error, { residentId });
    return intakeFailure(503, "retryable", "Could not load documents; try again");
  }
  return intakeJson({ documents: data ?? [] });
}

export async function downloadResidentDocument(residentId: string, documentId: string) {
  const auth = await requireDocumentIntakeActor(RESIDENT_DOCUMENT_ROLES);
  if ("response" in auth) return auth.response;
  if (!uuid.safeParse(residentId).success || !uuid.safeParse(documentId).success) {
    return intakeFailure(404, "missing", "Document not found");
  }
  const { actor } = auth;
  const resident = await visibleResident(actor, residentId);
  if ("response" in resident) return resident.response;

  const { data, error } = await actor.admin
    .from("resident_documents" as never)
    .select("id, storage_bucket, storage_path")
    .eq("id", documentId)
    .eq("resident_id", residentId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    logError("resident-documents.read", error, { residentId, documentId });
    return intakeFailure(503, "retryable", "Could not load the document; try again");
  }
  const row = data as { id: string; storage_bucket: string | null; storage_path: string | null } | null;
  if (!row?.storage_path || !RESIDENT_DOCUMENT_BUCKETS.has(row.storage_bucket ?? "")) {
    return intakeFailure(404, "missing", "Document not found");
  }
  const loaded = await downloadObject(actor.admin, row.storage_bucket as string, row.storage_path);
  if ("missing" in loaded) return intakeFailure(404, "missing", "The document file is missing from storage");
  if ("error" in loaded) {
    logError("resident-documents.download", loaded.error, { residentId, documentId });
    return intakeFailure(503, "retryable", "Could not load the document; try again");
  }
  // The type comes from the bytes, not the row: an unknown format is served as a download-only blob.
  const mime = sniffDocumentIntakeMime(loaded.bytes) ?? "application/octet-stream";
  return safeInlineBytes(loaded.bytes, mime, `document-${documentId}`);
}
