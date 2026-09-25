/**
 * DI-02 preview: stream an item's original (or a PNG preview of it) through an
 * authorized same-origin route. RLS decides visibility; the service client
 * reads the private bucket; the bytes are checked against the attested hash.
 */
import { z } from "zod";

import { logError } from "@/lib/observability/logger";
import { requireDocumentIntakeActor } from "./actor";
import { DocumentIntakeByteError, needsPreviewConversion } from "./bytes";
import { byteErrorResponse, intakeFailure, intakeRpcFailure, safeInlineBytes } from "./http";
import { convertToPreviewPng } from "./preview";
import { downloadVerifiedOriginal, isItemVisible, readItemStorage } from "./storage";

export async function streamDocumentIntakeSource(request: Request, itemId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  if (!z.string().uuid().safeParse(itemId).success) return intakeFailure(404, "missing", "Document not found");
  const { actor } = auth;

  const visibility = await isItemVisible(actor, itemId);
  if ("error" in visibility) return intakeRpcFailure("document-intake.source.visibility", visibility.error, { itemId });
  if (!visibility.visible) return intakeFailure(404, "missing", "Document not found");
  const stored = await readItemStorage(actor, itemId);
  if ("error" in stored) return intakeRpcFailure("document-intake.source.read", stored.error, { itemId });
  const item = stored.item;
  if (!item) return intakeFailure(404, "missing", "Document not found");
  if (!item.verified_sha256 || !item.verified_mime) return intakeFailure(409, "state", "The original has not been verified yet");

  try {
    const loaded = await downloadVerifiedOriginal(actor.admin, item.storage_path, item.verified_sha256);
    if ("error" in loaded) {
      logError("document-intake.source.download", loaded.error, { itemId });
      return intakeFailure(503, "retryable", "The original could not be read; try again");
    }
    const wantsPreview = new URL(request.url).searchParams.get("preview") === "1";
    if (wantsPreview && needsPreviewConversion(item.verified_mime)) {
      const png = await convertToPreviewPng(loaded.bytes);
      return safeInlineBytes(png, "image/png", `document-${itemId}-preview`);
    }
    return safeInlineBytes(loaded.bytes, item.verified_mime, `document-${itemId}`);
  } catch (error) {
    if (error instanceof DocumentIntakeByteError) return byteErrorResponse(error);
    logError("document-intake.source.stream", error, { itemId });
    return intakeFailure(503, "retryable", "The original could not be read; try again");
  }
}
