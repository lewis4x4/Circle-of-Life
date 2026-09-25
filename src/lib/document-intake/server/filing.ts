/**
 * DI-05 filing: a person approves a destination, the server copies the
 * verified original to the destination bucket, attests the copy, and the
 * person's completion writes exactly one destination record.
 */
import { z } from "zod";

import { logError } from "@/lib/observability/logger";
import {
  correctBodySchema,
  DESTINATION_KINDS,
  destinationHref,
  fileBodySchema,
} from "../contracts";
import { requireDocumentIntakeActor, revalidateDocumentIntakeActor } from "./actor";
import { DocumentIntakeByteError } from "./bytes";
import { byteErrorResponse, intakeFailure, intakeJson, intakeRpcFailure, readIntakeBody } from "./http";
import { deriveRequestKey } from "./request-key";
import { downloadVerifiedOriginal, uploadOrVerify } from "./storage";

const uuid = z.string().uuid();

const prepareFilingResultSchema = z.object({
  filing_id: z.string().uuid(),
  bucket: z.string().min(1),
  path: z.string().min(1),
  source_path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().min(1),
}).passthrough();

const completedFilingSchema = z.object({
  filing: z.object({
    id: z.string().uuid(),
    destination_kind: z.enum(DESTINATION_KINDS),
    subject_id: z.string().uuid(),
    facility_id: z.string().uuid(),
    destination_record_id: z.string().uuid().nullable(),
  }).passthrough(),
}).passthrough();

const FILING_RETRY = "Filing did not finish; retry with the same request key";

export async function fileDocumentIntakeItem(request: Request, itemId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, fileBodySchema);
  if ("response" in parsed) return parsed.response;
  if (!uuid.safeParse(itemId).success) return intakeFailure(404, "missing", "Document not found");
  const { request_key, expected_revision, ...destination } = parsed.body;
  const { actor } = auth;

  const prepared = await actor.client.rpc(
    "document_intake_prepare_filing" as never,
    {
      p_item: itemId,
      p_request_key: request_key,
      p_expected_revision: expected_revision,
      p_destination: {
        catalog_code: destination.catalog_code,
        subject_id: destination.subject_id,
        requirement_id: destination.requirement_id ?? null,
        title: destination.title,
        document_date: destination.document_date ?? null,
        expiration_date: destination.expiration_date ?? null,
      },
    } as never,
  );
  if (prepared.error) return intakeRpcFailure("document-intake.file.prepare", prepared.error, { itemId });
  const target = prepareFilingResultSchema.safeParse(prepared.data);
  if (!target.success) return intakeFailure(503, "retryable", FILING_RETRY);
  const filingId = target.data.filing_id;
  const retry = { filing_id: filingId };

  // A retried request: the filing may already be past the copy step.
  const state = await actor.admin
    .from("document_intake_filings" as never)
    .select("state")
    .eq("id", filingId)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();
  if (state.error || !state.data) {
    if (state.error) logError("document-intake.file.state", state.error, { itemId, filingId });
    return intakeFailure(503, "retryable", FILING_RETRY, retry);
  }
  const filingState = (state.data as { state: string }).state;
  if (filingState === "abandoned" || filingState === "corrected") {
    return intakeFailure(409, "state", "This filing was withdrawn; start a new filing", retry);
  }

  if (filingState !== "filed") {
    try {
      const original = await downloadVerifiedOriginal(actor.admin, target.data.source_path, target.data.sha256);
      if ("error" in original) {
        logError("document-intake.file.download", original.error, { itemId, filingId });
        return intakeFailure(503, "retryable", FILING_RETRY, retry);
      }
      const stored = await uploadOrVerify(actor.admin, target.data.bucket, target.data.path, original.bytes, target.data.mime);
      if ("error" in stored) {
        logError("document-intake.file.upload", stored.error, { itemId, filingId });
        return intakeFailure(503, "retryable", FILING_RETRY, retry);
      }
    } catch (error) {
      if (error instanceof DocumentIntakeByteError) return byteErrorResponse(error, retry);
      logError("document-intake.file.copy", error, { itemId, filingId });
      return intakeFailure(503, "retryable", FILING_RETRY, retry);
    }
    const attested = await actor.admin.rpc(
      "document_intake_attest_filing_object" as never,
      { p_filing: filingId, p_object_id: null, p_sha256: target.data.sha256 } as never,
    );
    if (attested.error) {
      logError("document-intake.file.attest", attested.error, { itemId, filingId });
      return intakeFailure(503, "retryable", FILING_RETRY, retry);
    }
  }

  const live = await revalidateDocumentIntakeActor(actor);
  if ("response" in live) return live.response;
  const completed = await live.actor.client.rpc(
    "document_intake_complete_filing" as never,
    { p_filing: filingId, p_request_key: deriveRequestKey(request_key, "complete") } as never,
  );
  if (completed.error) return intakeRpcFailure("document-intake.file.complete", completed.error, { itemId, filingId }, retry);
  const result = completedFilingSchema.safeParse(completed.data);
  if (!result.success || result.data.filing.id !== filingId) return intakeFailure(503, "retryable", FILING_RETRY, retry);
  const filing = result.data.filing;
  return intakeJson({ filing, href: destinationHref(filing.destination_kind, filing) });
}

export async function abandonDocumentIntakeFiling(filingId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  if (!uuid.safeParse(filingId).success) return intakeFailure(404, "missing", "Filing not found");
  const { error } = await auth.actor.client.rpc("document_intake_abandon_filing" as never, { p_filing: filingId } as never);
  if (error) return intakeRpcFailure("document-intake.filing.abandon", error, { filingId });
  return intakeJson({ filing_id: filingId, state: "abandoned" });
}

export async function correctDocumentIntakeFiling(request: Request, filingId: string) {
  const auth = await requireDocumentIntakeActor();
  if ("response" in auth) return auth.response;
  const parsed = await readIntakeBody(request, correctBodySchema);
  if ("response" in parsed) return parsed.response;
  if (!uuid.safeParse(filingId).success) return intakeFailure(404, "missing", "Filing not found");
  const { data, error } = await auth.actor.client.rpc(
    "document_intake_correct_filing" as never,
    { p_filing: filingId, p_request_key: parsed.body.request_key, p_reason: parsed.body.reason } as never,
  );
  if (error) return intakeRpcFailure("document-intake.filing.correct", error, { filingId });
  return intakeJson(data);
}
