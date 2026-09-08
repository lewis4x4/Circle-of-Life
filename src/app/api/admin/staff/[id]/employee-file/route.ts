import { z } from "zod";
import { employeeFileActor, employeeFileResponse, commandError } from "@/lib/staff/employee-file-server";

type Context = { params: Promise<{ id: string }> };
const command = z.object({ action: z.enum(["submit_record", "review_record", "sign_record", "record_duty", "record_attendance", "review_attendance", "record_corrective_action", "retract_corrective_action", "attach_record", "record_export"]), payload: z.record(z.string(), z.unknown()) });

export async function GET(_request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  const { actor, staff, canManage } = access;
  const client = actor.client;
  const [requirements, records, signatures, dutyEvents, attendance, correctiveActions, medicalAccess] = await Promise.all([
    client.from("employee_file_requirements" as never).select("*").eq("facility_id", staff.facility_id).is("deleted_at", null).order("title"),
    client.from("employee_file_records" as never).select("*").eq("staff_id", staff.id).is("deleted_at", null).order("created_at", { ascending: false }),
    client.from("employee_file_signatures" as never).select("*,employee_file_records!inner(staff_id)").eq("employee_file_records.staff_id", staff.id),
    client.from("employee_duty_events" as never).select("*").eq("staff_id", staff.id).order("occurred_at", { ascending: false }),
    client.from("staff_attendance_events" as never).select("*").eq("staff_id", staff.id).is("deleted_at", null).order("occurred_at", { ascending: false }),
    client.from("staff_discipline_records" as never).select("*").eq("staff_id", staff.id).is("deleted_at", null).order("effective_date", { ascending: false }),
    client.from("employee_medical_access" as never).select("user_id").eq("user_id", actor.id).eq("facility_id", staff.facility_id).is("revoked_at", null),
  ]);
  if ([requirements, records, signatures, dutyEvents, attendance, correctiveActions, medicalAccess].some((r) => r.error)) return employeeFileResponse({ error: "The employee file could not be loaded. Retry or contact your administrator." }, 503);
  const canMedical = staff.user_id === actor.id || !!medicalAccess.data?.length;
  return employeeFileResponse({ staff, requirements: requirements.data, records: records.data, signatures: signatures.data, dutyEvents: dutyEvents.data, attendance: attendance.data, correctiveActions: correctiveActions.data, canManage, canMedical, actorId: actor.id, actorRole: actor.appRole });
}

export async function POST(request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return employeeFileResponse({ error: "Invalid request." }, 400); }
  const parsed = command.safeParse(body);
  if (!parsed.success) return employeeFileResponse({ error: "Invalid employee-file action." }, 400);
  const { data, error } = await access.actor.client.rpc("haven_employee_file_command" as never, { p_staff_id: access.staff.id, p_action: parsed.data.action, p_payload: parsed.data.payload } as never);
  return error ? commandError(error) : employeeFileResponse({ result: data });
}
