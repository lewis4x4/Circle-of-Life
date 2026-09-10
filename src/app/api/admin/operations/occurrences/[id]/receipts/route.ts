import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { RECEIPT_SELECT, RECEIPT_VIEW_ROLES } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receipts of one managed occurrence (COL-142), read through the session so
 * the current subject and site authority governs every row. Performance and
 * verification receipts are returned in the order they were recorded.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, facility_id, organization_id, occurrence_kind")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.occurrences.receipts", readError, { action: "read", occurrenceId: id });
    return NextResponse.json({ error: "Occurrence unavailable" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string; occurrence_kind: string | null } | null;
  if (!target || !target.occurrence_kind || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  }
  // COL-143 adds the current evidence status and the satisfaction instant beside the immutable receipt columns.
  const { data, error } = await auth.actor.currentActor.client
    .from("operation_execution_receipts" as never)
    .select(`${RECEIPT_SELECT}, evidence_status_current, evidence_satisfied_at`)
    .eq("organization_id", auth.actor.organizationId)
    .eq("task_instance_id", id)
    .order("recorded_at", { ascending: true });
  if (error) {
    logError("admin.operations.occurrences.receipts", error, { action: "list", occurrenceId: id });
    return NextResponse.json({ error: "Receipts unavailable" }, { status: 503 });
  }
  return NextResponse.json({ receipts: data ?? [] });
}
