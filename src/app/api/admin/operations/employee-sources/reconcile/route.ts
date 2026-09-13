import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { composeEmployeeSources, employeeSourceReconcileSchema, type EmployeeSourceInput } from "@/lib/operations/employee-sources";
import { employeeSourceMap } from "@/lib/operations/employee-source-map";
export async function POST(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const body = employeeSourceReconcileSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose an employee task and request key" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const result = await current.actor.currentActor.client.rpc("employee_operation_source_snapshot" as never, { p_task: body.data.task_id, p_request_key: body.data.request_key } as never);
  if (result.error) return NextResponse.json({ error: "Source refresh could not be confirmed; retain the request for retry" }, { status: result.error.code === "42501" ? 404 : result.error.code === "23505" ? 409 : 503 });
  const latest = await revalidateOperationsActor(current.actor);
  if ("response" in latest) return latest.response;
  if (latest.actor.id !== auth.actor.id || latest.actor.organizationId !== auth.actor.organizationId || latest.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Employee source scope unavailable" }, { status: 404 });
  const fresh = await latest.actor.currentActor.client.rpc("employee_operation_source_snapshot" as never, { p_task: body.data.task_id, p_request_key: null } as never);
  const freshData: unknown = fresh.data;
  if (fresh.error || !freshData) return NextResponse.json({ error: "Current employee source access could not be confirmed" }, { status: fresh.error?.code === "42501" ? 404 : 503 });
  const input = freshData as EmployeeSourceInput;
  if (input.task_id !== body.data.task_id || !Array.isArray(input.requirements) || !Array.isArray(input.records) || !Array.isArray(input.history)) return NextResponse.json({ error: "Employee sources could not be confirmed" }, { status: 503 });
  return NextResponse.json(composeEmployeeSources(input, employeeSourceMap), { headers: { "Cache-Control": "no-store" } });
}
