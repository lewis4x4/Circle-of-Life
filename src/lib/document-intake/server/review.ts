/**
 * Review commands, split (DI-02 mixed packets) and the operations summary.
 */
import { z } from "zod";

import { logError } from "@/lib/observability/logger";
import { commandBodySchema, DOCUMENT_INTAKE_BUCKET, splitBodySchema } from "../contracts";
import { requireDocumentIntakeActor, revalidateDocumentIntakeActor } from "./actor";
import { cutPdfPages, DocumentIntakeByteError, loadPdfForSplit, sameSha256 } from "./bytes";
import { byteErrorResponse, intakeFailure, intakeJson, intakeRpcFailure, readIntakeBody } from "./http";
import { deriveRequestKey } from "./request-key";
import { prepareSplitResultSchema, splitPlanProblem } from "./split-plan";
import { downloadVerifiedOriginal, readItemStorage, uploadOrVerify } from "./storage";

const uuid = z.string().uuid();

export async function runDocumentIntakeCommand(request: Request, itemId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, commandBodySchema);
  if ("response" in parsed) return parsed.response;
  if (!uuid.safeParse(itemId).success) return intakeFailure(404, "missing", "Document not found");
  const { request_key, expected_revision, command, payload } = parsed.body;
  const { data, error } = await auth.actor.client.rpc(
    "document_intake_command" as never,
    { p_item: itemId, p_request_key: request_key, p_expected_revision: expected_revision, p_command: command, p_payload: payload } as never,
  );
  if (error) return intakeRpcFailure("document-intake.command", error, { itemId, command });
  return intakeJson(data);
}

export async function readDocumentIntakeSummary() {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.actor.client.rpc("document_intake_operations_summary" as never);
  if (error) return intakeRpcFailure("document-intake.summary", error, {});
  return intakeJson(data);
}

const SPLIT_RETRY = "The split could not be completed; retry with the same request key";

/**
 * Split a multi-page PDF into real separate files. Every step is safe to
 * repeat with the same request key: prepare replays, a child that is already
 * attested is skipped, an existing child object is accepted only when its
 * bytes are identical, and finalize uses a key derived from the request key.
 */
export async function splitDocumentIntakeItem(request: Request, itemId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, splitBodySchema);
  if ("response" in parsed) return parsed.response;
  if (!uuid.safeParse(itemId).success) return intakeFailure(404, "missing", "Document not found");
  const { request_key, expected_revision, parts, excluded_pages } = parsed.body;
  const problem = splitPlanProblem(parts, excluded_pages);
  if (problem) return intakeFailure(400, "validation", problem);
  const { actor } = auth;

  const prepared = await actor.client.rpc(
    "document_intake_prepare_split" as never,
    { p_item: itemId, p_request_key: request_key, p_expected_revision: expected_revision, p_parts: parts, p_excluded_pages: excluded_pages } as never,
  );
  if (prepared.error) return intakeRpcFailure("document-intake.split.prepare", prepared.error, { itemId });
  const plan = prepareSplitResultSchema.safeParse(prepared.data);
  if (!plan.success) return intakeFailure(503, "retryable", SPLIT_RETRY);

  try {
    const parentRead = await readItemStorage(actor, itemId);
    if ("error" in parentRead) return intakeRpcFailure("document-intake.split.parent-read", parentRead.error, { itemId });
    const parent = parentRead.item;
    if (!parent?.verified_sha256 || parent.verified_mime !== "application/pdf") {
      return intakeFailure(409, "state", "Only a verified PDF can be split");
    }
    const original = await downloadVerifiedOriginal(actor.admin, parent.storage_path, parent.verified_sha256);
    if ("error" in original) {
      logError("document-intake.split.download", original.error, { itemId });
      return intakeFailure(503, "retryable", SPLIT_RETRY);
    }
    const source = await loadPdfForSplit(original.bytes);

    for (const child of plan.data.children) {
      const childRead = await readItemStorage(actor, child.item_id);
      if ("error" in childRead) return intakeRpcFailure("document-intake.split.child-read", childRead.error, { itemId, childId: child.item_id });
      const row = childRead.item;
      if (!row || row.parent_item_id !== itemId || row.channel !== "split" || row.storage_path !== child.path) {
        return intakeFailure(503, "retryable", SPLIT_RETRY);
      }
      const cut = await cutPdfPages(source, child.pages);
      if (row.verified_sha256) {
        if (!sameSha256(row.verified_sha256, cut.sha256)) {
          return intakeFailure(409, "conflict", "A saved part does not match the pages it should hold");
        }
        continue;
      }
      const declared = await actor.admin.rpc(
        "document_intake_declare_split_child" as never,
        { p_item: child.item_id, p_size: cut.size, p_sha256: cut.sha256 } as never,
      );
      if (declared.error) return intakeRpcFailure("document-intake.split.declare", declared.error, { itemId, childId: child.item_id });
      const stored = await uploadOrVerify(actor.admin, DOCUMENT_INTAKE_BUCKET, child.path, cut.bytes, "application/pdf");
      if ("error" in stored) {
        logError("document-intake.split.upload", stored.error, { itemId, childId: child.item_id });
        return intakeFailure(503, "retryable", SPLIT_RETRY);
      }
      const attested = await actor.admin.rpc(
        "document_intake_attest_source" as never,
        { p_item: child.item_id, p_object_id: null, p_size: cut.size, p_mime: "application/pdf", p_sha256: cut.sha256, p_page_count: cut.pageCount } as never,
      );
      if (attested.error) return intakeRpcFailure("document-intake.split.attest", attested.error, { itemId, childId: child.item_id });
    }
  } catch (error) {
    if (error instanceof DocumentIntakeByteError) return byteErrorResponse(error);
    logError("document-intake.split.cut", error, { itemId });
    return intakeFailure(503, "retryable", SPLIT_RETRY);
  }

  const live = await revalidateDocumentIntakeActor(actor);
  if ("response" in live) return live.response;
  const finalized = await live.actor.client.rpc(
    "document_intake_finalize_split" as never,
    { p_item: itemId, p_request_key: deriveRequestKey(request_key, "finalize"), p_expected_revision: plan.data.parent_revision } as never,
  );
  if (finalized.error) return intakeRpcFailure("document-intake.split.finalize", finalized.error, { itemId });
  const item = (finalized.data as { item?: unknown } | null)?.item ?? null;
  return intakeJson({
    item,
    children: plan.data.children.map((child) => ({ item_id: child.item_id, pages: child.pages })),
  });
}
