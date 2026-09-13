import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { RECEIPT_COMMAND_ROLES, currentReceiptFields, isReversalOutcome, mapReceiptRpcError, payloadProblem, reverseWorkBodySchema, withoutRequestHash } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reverse recorded work on a managed occurrence (COL-145). A reversal is a
 * receipt of its own kind that supersedes the named effective performance
 * receipt (and any review of it) without replacing it; the occurrence
 * returns to unrecorded and can be recorded again as a new chain. The
 * reversed chain stays readable history and its evidence counts for nothing.
 * The database owns the locks, the identity conflict (naming the current
 * receipt), idempotency and the atomic write of receipts, occurrence and audit.
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
  const parsed = reverseWorkBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key, the receipt being reversed with its revision, and a reason", outcome: "validation" }, { status: 400 });
  }
  // The session read hides occurrences for sites and subjects without a current grant; legacy rows are not reversed here.
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, facility_id, organization_id, occurrence_kind")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.occurrences.reverse", readError, { action: "read", occurrenceId: id });
    return NextResponse.json({ error: "Occurrence unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string; occurrence_kind: string | null } | null;
  if (!target || !target.occurrence_kind || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Occurrence not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "reverse_operation_work_review" as never,
    {
      p_task: id,
      p_request_key: parsed.data.request_key,
      p_expected_receipt_id: parsed.data.expected_receipt_id,
      p_expected_receipt_revision: parsed.data.expected_receipt_revision,
      p_payload: parsed.data.payload,
    } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.reverse", error, { action: "rpc", occurrenceId: id });
    const mapped = mapReceiptRpcError(error, "reverse");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isReversalOutcome(result)) {
    return NextResponse.json({ error: "Reversal could not be confirmed; check the occurrence before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json({
    outcome: "receipt",
    receipt: withoutRequestHash(result.receipt),
    reversed: withoutRequestHash(result.reversed),
    occurrence: result.occurrence,
    verification_superseded_receipt_id: result.verification_superseded_receipt_id ?? null,
    replayed: result.replayed,
  });
}
