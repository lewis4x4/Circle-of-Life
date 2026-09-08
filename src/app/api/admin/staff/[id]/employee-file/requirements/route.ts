import { z } from "zod";
import { employeeFileActor, employeeFileResponse, commandError } from "@/lib/staff/employee-file-server";
type Context = { params: Promise<{ id: string }> };
const command = z.object({ action: z.enum(["create", "approve", "retire", "grant_medical", "revoke_medical"]), payload: z.record(z.string(), z.unknown()) });
export async function GET(_request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  if (!["owner", "org_admin"].includes(access.actor.appRole)) return employeeFileResponse({ error: "Organization administrator access required." }, 403);
  const [profiles, grants] = await Promise.all([
    access.actor.client.from("user_profiles").select("id,full_name,app_role").eq("organization_id", access.actor.organizationId).eq("is_active", true).is("deleted_at", null).order("full_name"),
    access.actor.client.from("employee_medical_access" as never).select("id,user_id,granted_at").eq("facility_id", access.staff.facility_id).is("revoked_at", null),
  ]);
  if (profiles.error || grants.error) return employeeFileResponse({ error: "Reviewer access could not be loaded." }, 503);
  return employeeFileResponse({ profiles: profiles.data, grants: grants.data });
}
export async function POST(request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  if (!access.canManage) return employeeFileResponse({ error: "Only an authorized manager can maintain requirements." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return employeeFileResponse({ error: "Invalid request." }, 400); }
  const parsed = command.safeParse(body);
  if (!parsed.success) return employeeFileResponse({ error: "Invalid requirement action." }, 400);
  const { data, error } = await access.actor.client.rpc("haven_employee_requirement_command" as never, { p_facility_id: access.staff.facility_id, p_action: parsed.data.action, p_payload: parsed.data.payload } as never);
  return error ? commandError(error) : employeeFileResponse({ result: data });
}
