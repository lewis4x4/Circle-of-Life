/**
 * DI-02 upload: prepare (reserve an item + signed upload URL) and finalize
 * (server byte verification, attestation, queue for reading).
 */
import { z } from "zod";

import { logError } from "@/lib/observability/logger";
import {
  DOCUMENT_INTAKE_BUCKET,
  finalizeUploadBodySchema,
  itemSchema,
  prepareUploadBodySchema,
} from "../contracts";
import { requireDocumentIntakeActor, revalidateDocumentIntakeActor } from "./actor";
import { countPages, DocumentIntakeByteError, verifyDeclaredBytes } from "./bytes";
import { byteErrorResponse, intakeFailure, intakeJson, intakeRpcFailure, readIntakeBody } from "./http";
import { downloadObject, isItemVisible, readItemStorage } from "./storage";

const rpcItemSchema = itemSchema.pick({ id: true, organization_id: true, status: true, revision: true }).passthrough();

const prepareResultSchema = z.object({ item: rpcItemSchema, path: z.string().min(1) }).passthrough();
const finalizeResultSchema = z.object({ item: rpcItemSchema, possible_duplicate_of: z.string().uuid().nullable().optional() }).passthrough();

/** Item JSON as the RPCs shape it: the row without storage_path / object_id. */
function publicItem(row: Record<string, unknown>) {
  const rest = { ...row };
  delete rest.storage_path;
  delete rest.object_id;
  return rest;
}

export async function prepareDocumentIntakeUpload(request: Request) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, prepareUploadBodySchema);
  if ("response" in parsed) return parsed.response;
  const { request_key, ...payload } = parsed.body;
  const { actor } = auth;

  const { data, error } = await actor.client.rpc(
    "document_intake_prepare_upload" as never,
    { p_request_key: request_key, p_payload: payload } as never,
  );
  if (error) return intakeRpcFailure("document-intake.upload.prepare", error, { requestKey: request_key });
  const result = prepareResultSchema.safeParse(data);
  if (!result.success || result.data.item.organization_id !== actor.organizationId) {
    return intakeFailure(503, "retryable", "The upload could not be confirmed; retry with the same request key");
  }
  const itemId = result.data.item.id;
  const replayed = (data as { replayed?: boolean }).replayed === true;

  // A replay returns the remembered result; the item may have moved on since.
  const current = await actor.admin
    .from("document_intake_items" as never)
    .select("*")
    .eq("id", itemId)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();
  const row = current.data as (Record<string, unknown> & { status: string; storage_path: string; created_by: string | null }) | null;
  if (current.error || !row || row.storage_path !== result.data.path || row.created_by !== actor.id) {
    if (current.error) logError("document-intake.upload.prepare-read", current.error, { itemId });
    return intakeFailure(503, "retryable", "The upload could not be confirmed; retry with the same request key");
  }
  const item = publicItem(row);
  if (row.status !== "receiving") return intakeJson({ item, upload: null, replayed });

  const signed = await actor.admin.storage.from(DOCUMENT_INTAKE_BUCKET).createSignedUploadUrl(row.storage_path);
  if (signed.error || !signed.data) {
    logError("document-intake.upload.signed-url", signed.error, { itemId });
    return intakeFailure(503, "retryable", "Upload link unavailable; retry with the same request key", { item });
  }
  return intakeJson({
    item,
    upload: { path: signed.data.path ?? row.storage_path, token: signed.data.token, signedUrl: signed.data.signedUrl },
    replayed,
  });
}

export async function finalizeDocumentIntakeUpload(request: Request, itemId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, finalizeUploadBodySchema);
  if ("response" in parsed) return parsed.response;
  if (!z.string().uuid().safeParse(itemId).success) return intakeFailure(404, "missing", "Document not found");
  const { actor } = auth;
  const { request_key } = parsed.body;

  const visibility = await isItemVisible(actor, itemId);
  if ("error" in visibility) return intakeRpcFailure("document-intake.upload.visibility", visibility.error, { itemId });
  const stored = await readItemStorage(actor, itemId);
  if ("error" in stored) return intakeRpcFailure("document-intake.upload.read", stored.error, { itemId });
  const item = stored.item;
  // Coordinators may upload but not review, so RLS hides their own upload from
  // them; the uploader is still allowed to finish it (the RPC checks the same).
  if (!item || (!visibility.visible && item.created_by !== actor.id)) {
    return intakeFailure(404, "missing", "Document not found");
  }

  if (!item.verified_sha256) {
    if (item.status !== "receiving") return intakeFailure(409, "state", "This upload can no longer be finished");
    const loaded = await downloadObject(actor.admin, DOCUMENT_INTAKE_BUCKET, item.storage_path);
    if ("missing" in loaded) return intakeFailure(409, "state", "The file has not been uploaded yet");
    if ("error" in loaded) {
      logError("document-intake.upload.download", loaded.error, { itemId });
      return intakeFailure(503, "retryable", "The uploaded file could not be read; retry with the same request key");
    }
    let verified: { sha256: string; pages: number };
    try {
      const { sha256 } = verifyDeclaredBytes(loaded.bytes, {
        mime: item.declared_mime,
        size: item.declared_size_bytes,
        sha256: item.declared_sha256,
      });
      verified = { sha256, pages: await countPages(loaded.bytes, item.declared_mime) };
    } catch (error) {
      if (error instanceof DocumentIntakeByteError) {
        // The bytes are definitively wrong: close the item so it does not sit in "receiving".
        const rejected = await actor.admin.rpc(
          "document_intake_reject_source" as never,
          { p_item: itemId, p_code: error.code } as never,
        );
        if (rejected.error) logError("document-intake.upload.reject", rejected.error, { itemId, code: error.code });
        return byteErrorResponse(error);
      }
      logError("document-intake.upload.verify", error, { itemId });
      return intakeFailure(503, "retryable", "The uploaded file could not be verified; retry with the same request key");
    }
    const attested = await actor.admin.rpc(
      "document_intake_attest_source" as never,
      {
        p_item: itemId,
        p_object_id: null,
        p_size: loaded.bytes.byteLength,
        p_mime: item.declared_mime,
        p_sha256: verified.sha256,
        p_page_count: verified.pages,
      } as never,
    );
    if (attested.error) return intakeRpcFailure("document-intake.upload.attest", attested.error, { itemId });
  }

  const live = await revalidateDocumentIntakeActor(actor);
  if ("response" in live) return live.response;
  const { data, error } = await live.actor.client.rpc(
    "document_intake_finalize_upload" as never,
    { p_item: itemId, p_request_key: request_key } as never,
  );
  if (error) return intakeRpcFailure("document-intake.upload.finalize", error, { itemId });
  const result = finalizeResultSchema.safeParse(data);
  if (!result.success || result.data.item.id !== itemId) {
    return intakeFailure(503, "retryable", "The upload could not be confirmed; retry with the same request key");
  }
  return intakeJson({ item: result.data.item, possible_duplicate_of: result.data.possible_duplicate_of ?? null });
}
