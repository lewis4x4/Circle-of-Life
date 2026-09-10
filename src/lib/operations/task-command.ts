import { NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { logError } from "@/lib/observability/logger";

/** The database locks the task and rechecks current subject/actor authority, including replay. */
export async function runOperationTaskCommand(
  taskId: string,
  action: "start" | "reinstate" | "escalate",
  payload: { reason?: string } = {},
) {
  const auth = await requireOperationsActor();
  if ("response" in auth) return auth.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;

  const { data, error } = await current.actor.currentActor.client.rpc(
    "haven_operation_task_command" as never,
    { p_task_id: taskId, p_action: action, p_payload: payload } as never,
  );
  if (error) {
    logError(`admin.operations.tasks.${action}`, error, { taskId, action: "rpc" });
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json(
      { error: status === 403 || status === 404 ? "Task unavailable" : "Task could not be updated. Refresh and retry." },
      { status },
    );
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    return NextResponse.json({ error: "Task update could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json(data);
}
