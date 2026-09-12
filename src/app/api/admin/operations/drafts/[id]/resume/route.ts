import { NextRequest, NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { DRAFT_COMMAND_ROLES, DRAFT_COMMANDS, DRAFT_RPC, isResumeOutcome, mapResumeRpcError, presentDraft, presentResumedReply, readDraftTarget, resumeErrorFields, type DraftCommand } from "@/lib/operations/recovery";
import { logError } from "@/lib/observability/logger";

const SCOPE = "admin.operations.drafts.resume";

/**
 * Resume one of the caller's own unsaved drafts (COL-146): the database
 * executes the stored command with the stored arguments under the actor's
 * current authority. The command is idempotent by request key, so a resume
 * after a lost-but-committed answer replays the one record; a resume never
 * submits edited content. The command's own refusal is mapped exactly as
 * its original route would map it and leaves the draft pending.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireOperationsActor({ allowedRoles: DRAFT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  const read = await readDraftTarget(auth.actor, id, SCOPE);
  if ("response" in read) return read.response;
  if (!(DRAFT_COMMANDS as readonly string[]).includes(read.target.command)) {
    return NextResponse.json({ error: "Resume could not be confirmed; check the draft before retrying", outcome: "uncertain" }, { status: 500 });
  }
  const command = read.target.command as DraftCommand;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(DRAFT_RPC.resume as never, { p_draft: id } as never);
  if (error) {
    logError(SCOPE, error, { action: "rpc", draftId: id, command });
    const mapped = mapResumeRpcError(error, command);
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...resumeErrorFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  const reply = isResumeOutcome(result) ? presentResumedReply(command, result.reply) : null;
  if (!isResumeOutcome(result) || !reply) {
    return NextResponse.json({ error: "Resume could not be confirmed; check the draft before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json({ outcome: "saved", draft: presentDraft(result.draft), reply });
}
