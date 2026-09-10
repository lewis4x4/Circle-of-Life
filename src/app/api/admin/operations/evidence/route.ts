import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "@/lib/operations/auth";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_COMMAND_ROLES,
  EVIDENCE_SELECT,
  EVIDENCE_VIEW_ROLES,
  evidencePayloadProblem,
  evidenceResultReply,
  isAttached,
  isEvidenceOutcome,
  mapEvidenceRpcError,
  prepareEvidenceBodySchema,
  presentEvidence,
  type EvidenceRow,
} from "@/lib/operations/evidence";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptTarget = { id: string; organization_id: string; facility_id: string };

/** Session read of the receipt: RLS hides other sites and restricted subjects; the current site grant is checked before anything else. The database enforces that it is the effective performance receipt. */
async function readReceipt(actor: OperationsActor, receiptId: string, scope: string): Promise<{ target: ReceiptTarget } | { response: NextResponse }> {
  const { data: row, error: readError } = await actor.currentActor.client
    .from("operation_execution_receipts" as never)
    .select("id, organization_id, facility_id")
    .eq("id", receiptId)
    .maybeSingle();
  if (readError) {
    logError(scope, readError, { action: "read", receiptId });
    return { response: NextResponse.json({ error: "Receipt unavailable", outcome: "uncertain" }, { status: 503 }) };
  }
  const target = row as ReceiptTarget | null;
  if (!target || target.organization_id !== actor.organizationId || !(await actorCanAccessFacility(actor, target.facility_id))) {
    return { response: NextResponse.json({ error: "Receipt not found", outcome: "missing" }, { status: 404 }) };
  }
  return { target };
}

/**
 * Prepare evidence for a performance receipt (COL-143). The database mints
 * the evidence identity and its owned object path and records the declared
 * MD5 of the bytes (verified against the Storage eTag at upload marking and
 * finalization); for object kinds the route then asks Storage, through the
 * session's own policies, for a signed upload URL. No service-role Storage
 * call is made and no byte moves here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: EVIDENCE_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = prepareEvidenceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: evidencePayloadProblem(parsed.error) ?? "Provide a receipt, a request key and an evidence payload with a kind", outcome: "validation" }, { status: 400 });
  }
  const scope = "admin.operations.evidence.prepare";
  const read = await readReceipt(auth.actor, parsed.data.receipt_id, scope);
  if ("response" in read) return read.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "prepare_operation_evidence_review" as never,
    { p_receipt: parsed.data.receipt_id, p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError(scope, error, { action: "rpc", receiptId: parsed.data.receipt_id });
    const mapped = mapEvidenceRpcError(error, "prepare");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...(mapped.existing_evidence_id ? { existing_evidence_id: mapped.existing_evidence_id } : {}) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isEvidenceOutcome(result)) {
    return NextResponse.json({ error: "Evidence preparation could not be confirmed; re-read the evidence before retrying", outcome: "uncertain" }, { status: 500 });
  }
  // A linked record is finalized at preparation and may satisfy the receipt at once; the satisfaction outcome rides along.
  const { status, body: reply } = evidenceResultReply(result, current.actor.id, "prepare");
  const path = typeof result.evidence.object_path === "string" ? result.evidence.object_path : null;
  const inFlight = result.evidence.state === "prepared";
  if (path && inFlight) {
    // The session's own Storage policy decides whether this uploader may write this path.
    const { data: upload, error: uploadError } = await current.actor.currentActor.client.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
    if (uploadError || !upload) {
      if (uploadError) logError(scope, uploadError, { action: "signed-upload-url", evidenceId: result.evidence.id });
      reply.upload = null;
      reply.upload_error = "Upload URL unavailable; retry";
    } else {
      reply.upload = { path: upload.path ?? path, token: upload.token, signedUrl: upload.signedUrl };
    }
  } else {
    reply.upload = null;
  }
  // Prepare only ever reports prepared or finalized today; the status comes from the same classification as the other commands.
  return NextResponse.json(reply, { status });
}

/**
 * Evidence of one receipt: finalized rows for everyone with current task
 * access plus the caller's own in-flight rows. Another uploader's in-flight
 * rows and every object path except the caller's own stay on the server.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: EVIDENCE_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const receiptId = request.nextUrl.searchParams.get("receipt_id");
  if (!receiptId || !UUID.test(receiptId)) return NextResponse.json({ error: "receipt_id is required", outcome: "validation" }, { status: 400 });
  const scope = "admin.operations.evidence.list";
  const read = await readReceipt(auth.actor, receiptId, scope);
  if ("response" in read) return read.response;
  const { data, error } = await auth.actor.currentActor.client
    .from("operation_evidence" as never)
    .select(EVIDENCE_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("receipt_id", receiptId)
    .order("prepared_at", { ascending: true });
  if (error) {
    logError(scope, error, { action: "list", receiptId });
    return NextResponse.json({ error: "Evidence unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const rows = ((data ?? []) as unknown as EvidenceRow[]).filter((row) => isAttached(row) || row.uploaded_by === auth.actor.id);
  return NextResponse.json({ evidence: rows.map((row) => presentEvidence(row, auth.actor.id)) });
}
