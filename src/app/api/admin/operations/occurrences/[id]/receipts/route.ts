import { readAllOperationRows } from "@/lib/operations/read-all";
import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { RECEIPT_SELECT, RECEIPT_VIEW_ROLES } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receipts of one managed occurrence (COL-142), read through the session so
 * the current subject and site authority governs every row. The whole
 * history is returned in the order it was recorded: recordings, corrections,
 * reversals and reviews, each with its chain, supersession and review-binding
 * columns (COL-145) beside the current evidence status (COL-143).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const actor = auth.actor;
  type Target = {
    id: string; facility_id: string; organization_id: string; occurrence_kind: string | null;
    status: string; execution_state: string | null; occurrence_revision: string | null;
    effective_receipt_id: string | null; performed_at: string | null;
  };
  const readTarget = async (): Promise<{ target: Target } | { response: NextResponse }> => {
    const { data: row, error: readError } = await actor.currentActor.client
      .from("operation_task_instances" as never)
      .select("id, facility_id, organization_id, occurrence_kind, status, execution_state, occurrence_revision, effective_receipt_id, performed_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) {
      logError("admin.operations.occurrences.receipts", readError, { action: "read", occurrenceId: id });
      return { response: NextResponse.json({ error: "Occurrence unavailable" }, { status: 503 }) };
    }
    const target = row as Target | null;
    if (!target || !target.occurrence_kind || target.organization_id !== actor.organizationId || !(await actorCanAccessFacility(actor, target.facility_id))) {
      return { response: NextResponse.json({ error: "Occurrence not found" }, { status: 404 }) };
    }
    return { target };
  };
  // A lost-answer command can commit during chain pagination. Bracket the chain
  // with authorized lifecycle reads; retry it once rather than combine old state
  // with a new receipt. Persistent movement is explicitly retryable.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await readTarget();
    if ("response" in before) return before.response;
    const { data, error } = await readAllOperationRows(() => actor.currentActor.client
      .from("operation_execution_receipts" as never)
      .select(`${RECEIPT_SELECT}, evidence_status_current, evidence_satisfied_at`)
      .eq("organization_id", actor.organizationId)
      .eq("task_instance_id", id)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true }));
    if (error) {
      logError("admin.operations.occurrences.receipts", error, { action: "list", occurrenceId: id });
      return NextResponse.json({ error: "Receipts unavailable" }, { status: 503 });
    }
    const after = await readTarget();
    if ("response" in after) return after.response;
    const fields = ["id", "facility_id", "organization_id", "occurrence_kind", "status", "execution_state", "occurrence_revision", "effective_receipt_id", "performed_at"] as const;
    if (!fields.every((field) => before.target[field] === after.target[field])) continue;
    const target = after.target;
    // Explicit projection lets reconciliation hydrate current state without exposing subject details.
    return NextResponse.json({
      receipts: data ?? [],
      occurrence: {
        id: target.id,
        status: target.status,
        execution_state: target.execution_state,
        occurrence_revision: target.occurrence_revision,
        effective_receipt_id: target.effective_receipt_id,
        performed_at: target.performed_at,
      },
    });
  }
  return NextResponse.json({ error: "Occurrence changed while reading receipts; retry", outcome: "uncertain" }, { status: 503 });
}
