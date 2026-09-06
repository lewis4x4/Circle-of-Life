import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";

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

  let body: { completion_notes?: string; completion_evidence_paths?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const { data, error } = await actor.admin
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, assigned_to, assigned_role, status, due_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  const task = data as unknown as TaskRow | null;
  if (error || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const canMutate = await actorCanMutateTask(actor, task);
  if (!canMutate) {
    return NextResponse.json({ error: "Not authorized to complete this task" }, { status: 403 });
  }

  const result = await actor.admin.rpc("complete_operation_task_review" as never, { p_task_id: id, p_actor_id: actor.id, p_actor_role: actor.appRole, p_notes: body.completion_notes ?? "", p_evidence: body.completion_evidence_paths ?? [] } as never);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json({ success: true, status: result.data });
}
