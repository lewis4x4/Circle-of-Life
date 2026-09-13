import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { composeFinanceSources, financeSourceInputSchema, financeSourcePeriodSchema } from "@/lib/operations/finance-sources";
import { financeSourceMap } from "@/lib/operations/finance-source-map";
export async function GET(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const query = new URL(request.url).searchParams;
  const period = financeSourcePeriodSchema.safeParse({ task_id: query.get("task_id"), start_date: query.get("start_date"), end_date: query.get("end_date") });
  if (!period.success) return NextResponse.json({ error: "Choose a task and period of 1 to 366 days" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole) return NextResponse.json({ error: "Finance source scope unavailable" }, { status: 404 });
  const { data, error } = await current.actor.currentActor.client.rpc("finance_operation_source_snapshot" as never, { p_task: period.data.task_id, p_start: period.data.start_date, p_end: period.data.end_date, p_request_key: null } as never);
  if (error) return NextResponse.json({ error: "Finance source coverage could not be confirmed. Choose a smaller period if it exceeds the complete-read bound." }, { status: error.code === "42501" ? 404 : error.code === "22023" ? 400 : 503 });
  const parsed = financeSourceInputSchema.safeParse(data);
  if (!parsed.success || parsed.data.task_id !== period.data.task_id || parsed.data.start_date !== period.data.start_date || parsed.data.end_date !== period.data.end_date) return NextResponse.json({ error: "Finance source coverage could not be confirmed" }, { status: 503 });
  return NextResponse.json(composeFinanceSources(parsed.data, financeSourceMap), { headers: { "Cache-Control": "no-store" } });
}
