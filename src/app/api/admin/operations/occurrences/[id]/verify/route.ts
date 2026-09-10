import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { RECEIPT_COMMAND_ROLES, currentReceiptFields, isReceiptOutcome, mapReceiptRpcError, payloadProblem, withoutRequestHash, verifyWorkBodySchema } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Independent verification of recorded work (COL-142): a separate reviewer
 * receipt for occurrences whose rule requires review. COL-145 binds the
 * review to the exact performance receipt the reviewer read (`receipt_id`
 * and `receipt_revision`); a review of a receipt that has since been
 * corrected or reversed conflicts, naming the current receipt. The database
 * enforces the reviewer role, independence from the performer and recorder,
 * evidence completeness, the binding and idempotency.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Occurrence not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = verifyWorkBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key, a verification decision and the reviewed receipt with its revision", outcome: "validation" }, { status: 400 });
  }
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, facility_id, organization_id, occurrence_kind")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.occurrences.verify", readError, { action: "read", occurrenceId: id });
    return NextResponse.json({ error: "Occurrence unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string; occurrence_kind: string | null } | null;
  if (!target || !target.occurrence_kind || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Occurrence not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "verify_operation_work_review" as never,
    { p_task: id, p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.verify", error, { action: "rpc", occurrenceId: id });
    const mapped = mapReceiptRpcError(error, "verify");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isReceiptOutcome(result)) {
    return NextResponse.json({ error: "Verification could not be confirmed; check the occurrence before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json({ outcome: "receipt", receipt: withoutRequestHash(result.receipt), occurrence: result.occurrence, issue: result.issue ? withoutRequestHash(result.issue) : null, replayed: result.replayed });
}
