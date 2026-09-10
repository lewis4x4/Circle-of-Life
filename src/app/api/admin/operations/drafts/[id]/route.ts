import { NextRequest, NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { DRAFT_RPC, DRAFT_VIEW_ROLES, isReconcileOutcome, mapDraftRpcError, presentDraft, readDraftTarget } from "@/lib/operations/recovery";
import { withoutRequestHash } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const SCOPE = "admin.operations.drafts.reconcile";

/**
 * Reconcile one of the caller's own drafts (COL-146): the database looks the
 * request key up for the same actor and answers `saved` with the record,
 * `unsaved`, `expired` or `discarded`. Idempotent; never executes anything.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireOperationsActor({ allowedRoles: DRAFT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const read = await readDraftTarget(auth.actor, id, SCOPE);
  if ("response" in read) return read.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(DRAFT_RPC.reconcile as never, { p_draft: id } as never);
  if (error) {
    logError(SCOPE, error, { action: "rpc", draftId: id });
    const mapped = mapDraftRpcError(error, "reconcile");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isReconcileOutcome(result)) {
    return NextResponse.json({ error: "Reconciliation could not be confirmed; check the draft before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json({
    outcome: result.outcome,
    draft: presentDraft(result.draft),
    ...(result.outcome === "saved" && result.record ? { record: withoutRequestHash(result.record as Record<string, unknown> & { id: string }) } : {}),
  });
}
