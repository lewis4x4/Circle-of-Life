import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "@/lib/operations/auth";
import { corporateDeliverableCommandSchema, corporateDeliverablesReplySchema } from "@/lib/operations/corporate-deliverables";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";

const failure = (status = 503) => NextResponse.json({ error: "Current corporate deliverable coverage could not be confirmed" }, { status });
async function current(actor: OperationsActor) {
  const refreshed = await revalidateOperationsActor(actor);
  if ("response" in refreshed) return refreshed;
  if (refreshed.actor.id !== actor.id || refreshed.actor.organizationId !== actor.organizationId || refreshed.actor.appRole !== actor.appRole) return { response: failure(404) };
  return refreshed;
}
async function read(actor: OperationsActor, task: string, start: string, end: string) {
  const { data, error } = await actor.currentActor.client.rpc("corporate_deliverable_snapshot" as never, { p_task: task, p_start: start, p_end: end } as never);
  const parsed = corporateDeliverablesReplySchema.safeParse(data);
  if (error || !parsed.success || parsed.data.task_id !== task || parsed.data.period_start !== start || parsed.data.period_end !== end) return failure(error?.code === "42501" ? 404 : error?.code === "22023" ? 400 : 503);
  return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  const auth = await requireOperationsActor();
  if ("response" in auth) return auth.response;
  const query = new URL(request.url).searchParams;
  const task = query.get("task_id"), start = query.get("period_start"), end = query.get("period_end");
  if (!databaseUuidSchema.safeParse(task).success || !/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) return failure(400);
  const live = await current(auth.actor);
  if ("response" in live) return live.response;
  return read(live.actor, task!, start!, end!);
}
export async function POST(request: Request) {
  const auth = await requireOperationsActor();
  if ("response" in auth) return auth.response;
  const body = corporateDeliverableCommandSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return failure(400);
  let live = await current(auth.actor);
  if ("response" in live) return live.response;
  const { task_id, request_key, action, ...payload } = body.data;
  const result = await live.actor.currentActor.client.rpc("corporate_deliverable_command" as never, { p_task: task_id, p_request_key: request_key, p_action: action, p_payload: payload } as never);
  if (result.error) return failure(result.error.code === "42501" ? 404 : ["40001", "23505"].includes(result.error.code) ? 409 : result.error.code === "22023" ? 400 : result.error.code === "54000" ? 413 : 503);
  live = await current(live.actor);
  if ("response" in live) return live.response;
  const periodStart = "period_start" in body.data ? body.data.period_start : String((result.data as { period_start?: unknown } | null)?.period_start ?? "");
  const periodEnd = "period_end" in body.data ? body.data.period_end : String((result.data as { period_end?: unknown } | null)?.period_end ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return failure();
  return read(live.actor, task_id, periodStart, periodEnd);
}
