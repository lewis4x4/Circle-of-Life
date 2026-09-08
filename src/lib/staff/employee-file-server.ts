import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import type { EmployeeSummary } from "./employee-file";

export const EMPLOYEE_MANAGERS = ["owner", "org_admin", "facility_admin", "manager"] as const;
export function employeeFileResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function employeeFileActor(staffId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) return { response: employeeFileResponse({ error: "Invalid employee." }, 400) };
  const result = await requireCurrentApiActor({ scope: "employee-file" });
  if ("response" in result) return result;
  const { actor } = result;
  const { data, error } = await actor.client.rpc("haven_employee_file_staff" as never, { p_staff_id: staffId } as never).maybeSingle();
  if (error) return { response: employeeFileResponse({ error: "Employee access could not be verified." }, 503) };
  const staff = data as EmployeeSummary | null;
  const canManage = (EMPLOYEE_MANAGERS as readonly string[]).includes(actor.appRole);
  const canCountersign = ["nurse", "coordinator"].includes(actor.appRole);
  if (!staff) return { response: employeeFileResponse({ error: "Employee not found or access denied." }, 404) };
  if (!canManage && !canCountersign && staff.user_id !== actor.id) {
    const grant = await actor.client.from("employee_medical_access" as never).select("id").eq("user_id", actor.id).eq("facility_id", staff.facility_id).eq("organization_id", actor.organizationId).is("revoked_at", null);
    if (grant.error || !grant.data?.length) return { response: employeeFileResponse({ error: "Employee not found or access denied." }, 404) };
  }
  // Even org managers use caller RLS for every read and mutation below.
  return { actor, staff, canManage };
}

export function commandError(error: { code?: string; message: string }) {
  const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : ["22023", "23514", "P0001"].includes(error.code ?? "") ? 400 : 503;
  return employeeFileResponse({ error: status === 503 ? "Could not save this change. Please retry." : error.message }, status);
}
