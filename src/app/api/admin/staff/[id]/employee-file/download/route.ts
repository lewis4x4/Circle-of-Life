import { employeeFileActor, employeeFileResponse } from "@/lib/staff/employee-file-server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  const recordId = new URL(request.url).searchParams.get("record_id");
  if (!recordId) return employeeFileResponse({ error: "Document required." }, 400);
  const { data, error } = await access.actor.client.from("employee_file_records" as never).select("storage_path,employee_file_requirements!inner(category)").eq("id", recordId).eq("staff_id", access.staff.id).is("deleted_at", null).maybeSingle();
  const record = data as { storage_path: string | null; employee_file_requirements: { category: string } } | null;
  if (error || !record?.storage_path) return employeeFileResponse({ error: "Document unavailable or access denied." }, 404);
  const bucket = record.employee_file_requirements.category === "medical" ? "employee-medical" : "employee-personnel";
  const audit = await access.actor.client.rpc("haven_employee_file_command" as never, { p_staff_id: access.staff.id, p_action: "record_download", p_payload: { id: recordId } } as never);
  if (audit.error) return employeeFileResponse({ error: "Document access could not be recorded. Please retry." }, 503);
  const result = await access.actor.client.storage.from(bucket).createSignedUrl(record.storage_path, 60, { download: true });
  return result.error ? employeeFileResponse({ error: "Document access could not be verified." }, 403) : employeeFileResponse({ url: result.data.signedUrl });
}
