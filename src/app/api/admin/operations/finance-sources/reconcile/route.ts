import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { composeFinanceSources, financeSourceInputSchema, financeSourceReconcileSchema } from "@/lib/operations/finance-sources";
import { financeSourceMap } from "@/lib/operations/finance-source-map";
export async function POST(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const body = financeSourceReconcileSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose a task, bounded period and request key" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole) return NextResponse.json({ error: "Finance source scope unavailable" }, { status: 404 });
  const args = { p_task: body.data.task_id, p_start: body.data.start_date, p_end: body.data.end_date, p_request_key: body.data.request_key };
  const result = await current.actor.currentActor.client.rpc("finance_operation_source_snapshot" as never, args as never);
  if (result.error) return NextResponse.json({ error: "Refresh could not be confirmed; keep this request for an identical retry" }, { status: result.error.code === "42501" ? 404 : result.error.code === "23505" ? 409 : result.error.code === "22023" ? 400 : 503 });
  const latest = await revalidateOperationsActor(current.actor);
  if ("response" in latest) return latest.response;
  if (latest.actor.id !== auth.actor.id || latest.actor.organizationId !== auth.actor.organizationId || latest.actor.appRole !== auth.actor.appRole) return NextResponse.json({ error: "Finance source scope unavailable" }, { status: 404 });
  const fresh = await latest.actor.currentActor.client.rpc("finance_operation_source_snapshot" as never, { ...args, p_request_key: null } as never);
  const parsed = financeSourceInputSchema.safeParse(fresh.data);
  if (fresh.error || !parsed.success || parsed.data.task_id !== body.data.task_id || parsed.data.start_date !== body.data.start_date || parsed.data.end_date !== body.data.end_date) return NextResponse.json({ error: "Current finance source access could not be confirmed" }, { status: fresh.error?.code === "42501" ? 404 : 503 });
  return NextResponse.json(composeFinanceSources(parsed.data, financeSourceMap), { headers: { "Cache-Control": "no-store" } });
}
