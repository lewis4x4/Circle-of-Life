import { employeeFileActor, employeeFileResponse } from "@/lib/staff/employee-file-server";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  const [completions, certificates, demonstrations] = await Promise.all([
    access.actor.client.from("staff_training_completions" as never).select("id,completed_at,expires_at,certificate_number,external_provider,training_programs(name)").eq("staff_id", access.staff.id).is("deleted_at", null),
    access.actor.client.from("staff_certifications" as never).select("id,certification_name,issue_date,expiration_date,status").eq("staff_id", access.staff.id).is("deleted_at", null),
    access.actor.client.from("competency_demonstrations" as never).select("id,status").eq("staff_id", access.staff.id).is("deleted_at", null),
  ]);
  if ([completions, certificates, demonstrations].some((r) => r.error)) return employeeFileResponse({ error: "Existing training evidence could not be loaded." }, 503);
  return employeeFileResponse({ completions: completions.data, certificates: certificates.data, demonstrations: demonstrations.data });
}
