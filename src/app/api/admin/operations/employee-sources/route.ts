import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { composeEmployeeSources, type EmployeeSourceInput } from "@/lib/operations/employee-sources";
import { employeeSourceMap } from "@/lib/operations/employee-source-map";
export async function GET(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("task_id");
  if (!databaseUuidSchema.safeParse(id).success) return NextResponse.json({ error: "Choose an employee task" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Employee source scope unavailable" }, { status: 404 });
  const { data, error } = await current.actor.currentActor.client.rpc("employee_operation_source_snapshot" as never, { p_task: id, p_request_key: null } as never);
  if (error || !data) return NextResponse.json({ error: "Employee sources unavailable; no readiness result is established" }, { status: error?.code === "42501" ? 404 : 503 });
  const input = data as unknown as EmployeeSourceInput;
  if (input.task_id !== id || !Array.isArray(input.requirements) || !Array.isArray(input.records) || !Array.isArray(input.history)) return NextResponse.json({ error: "Employee sources could not be confirmed" }, { status: 503 });
  return NextResponse.json(composeEmployeeSources(input, employeeSourceMap), { headers: { "Cache-Control": "no-store" } });
}
