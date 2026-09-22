import { NextRequest, NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { actorCanMutateTask, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const TRUSTED_COMPLETION_ERRORS = new Set([
  "Task cannot be completed from this state",
  "A different authorized staff member must verify this task",
  // COL-142: managed occurrences are recorded through the receipt command, not this legacy path.
  "Managed occurrences are recorded through the receipt command",
]);

/** Observation outcomes Home can record on a check (COL-593 §4.3). */
export const COMPLETION_OUTCOMES = ["ran", "did_not_run"] as const;
export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

export function isCompletionOutcome(value: unknown): value is CompletionOutcome {
  return typeof value === "string" && (COMPLETION_OUTCOMES as readonly string[]).includes(value);
}

/** Plain-words prefix so the outcome is searchable in completion_notes and the audit row. */
export function formatCompletionNotes(outcome: CompletionOutcome | undefined, note: string): string {
  if (outcome === "did_not_run") return note ? `Outcome: did not run. ${note}` : "Outcome: did not run.";
  if (outcome === "ran") return note ? `Outcome: ran. ${note}` : "Outcome: ran.";
  return note;
}

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  assigned_role: string | null;
  status: string;
  due_at: string | null;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  const { id } = await params;

  let body: { completion_notes?: string; completion_evidence_paths?: string[]; outcome?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body || (body.completion_notes !== undefined && typeof body.completion_notes !== "string") ||
      (body.completion_evidence_paths !== undefined && !Array.isArray(body.completion_evidence_paths)) ||
      (body.outcome !== undefined && !isCompletionOutcome(body.outcome))) {
    return NextResponse.json({ error: "Invalid completion details" }, { status: 400 });
  }
  // COL-593: an observation with a negative outcome ("Did not run") is still a
  // completed check, but never a silent one. The note is required and the
  // outcome is written into the completion notes the audit row already keeps.
  const outcome = body.outcome as CompletionOutcome | undefined;
  const noteText = body.completion_notes?.trim() ?? "";
  if (outcome === "did_not_run" && noteText.length === 0) {
    return NextResponse.json({ error: "A note is required when the check did not pass" }, { status: 400 });
  }
  const completionNotes = formatCompletionNotes(outcome, noteText);
  // Raw paths have no verified site/subject classification. COL-143 adds finalized evidence IDs.
  if ((body.completion_evidence_paths?.length ?? 0) > 0) {
    return NextResponse.json({ error: "Evidence must use a verified task attachment" }, { status: 409 });
  }

  const { data, error } = await actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, assigned_to, assigned_role, status, due_at")
    .eq("id", id)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  const task = data as unknown as TaskRow | null;
  if (error || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const currentResult = await revalidateOperationsActor(actor);
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  const canMutate = await actorCanMutateTask(currentActor, task);
  if (!canMutate) {
    return NextResponse.json({ error: "Not authorized to complete this task" }, { status: 403 });
  }

  const result = await currentActor.currentActor.client.rpc("complete_operation_task_review" as never, { p_task_id: id, p_actor_id: currentActor.id, p_actor_role: currentActor.appRole, p_notes: completionNotes, p_evidence: body.completion_evidence_paths ?? [] } as never);
  if (result.error) {
    logError("admin.operations.tasks.complete", result.error, {
      action: "rpc",
      taskId: id,
      facilityId: task.facility_id,
    });
    const error = TRUSTED_COMPLETION_ERRORS.has(result.error.message)
      ? result.error.message
      : "Task could not be completed. Refresh the task and retry.";
    return NextResponse.json({ error }, { status: 409 });
  }
  const completionStatus: unknown = result.data;
  if (completionStatus !== "completed" && completionStatus !== "awaiting_verification") {
    return NextResponse.json({ error: "Task completion could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, status: completionStatus });
}
