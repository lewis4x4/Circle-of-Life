import { NextRequest, NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { DRAFT_COMMAND_ROLES, DRAFT_RPC, isDiscardOutcome, mapDraftRpcError, presentDraft, readDraftTarget } from "@/lib/operations/recovery";
import { logError } from "@/lib/observability/logger";

const SCOPE = "admin.operations.drafts.discard";

/**
 * Discard one of the caller's own drafts (COL-146): pending becomes
 * discarded and can never be resumed. Idempotent on a discarded draft. The
 * database refuses to discard a reconciled draft; the record stands.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireOperationsActor({ allowedRoles: DRAFT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  const read = await readDraftTarget(auth.actor, id, SCOPE);
  if ("response" in read) return read.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(DRAFT_RPC.discard as never, { p_draft: id } as never);
  if (error) {
    logError(SCOPE, error, { action: "rpc", draftId: id });
    const mapped = mapDraftRpcError(error, "discard");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isDiscardOutcome(result)) return NextResponse.json({ error: "Discard could not be confirmed; check the draft before retrying", outcome: "uncertain" }, { status: 500 });
  return NextResponse.json({ outcome: "discarded", draft: presentDraft(result.draft) });
}
