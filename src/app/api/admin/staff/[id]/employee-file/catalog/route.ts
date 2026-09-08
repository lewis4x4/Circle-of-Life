import packetTemplates from "../../../../../../../../docs/employee-lifecycle/requirements.json";
import { employeeFileActor, employeeFileResponse } from "@/lib/staff/employee-file-server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  if (!access.canManage) return employeeFileResponse({ error: "Employee requirement management unavailable." }, 403);
  return employeeFileResponse(packetTemplates);
}
