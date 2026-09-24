import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { createPacketSchema } from "@/lib/payroll-packets/validation";
import { createPayrollPacket, getPacketHub, PACKET_ROLES } from "@/lib/payroll-packets/server";
import { payrollBody, payrollError, payrollJson } from "@/lib/payroll-packets/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.list" });
  if ("response" in auth) return auth.response;
  try { return payrollJson(await getPacketHub(auth.actor, databaseUuidSchema.parse(new URL(request.url).searchParams.get("facility_id")))); }
  catch (error) { return payrollError(error); }
}
export async function POST(request: Request) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.create" });
  if ("response" in auth) return auth.response;
  try { return payrollJson({ packet: await createPayrollPacket(auth.actor, createPacketSchema.parse(await payrollBody(request))) }, 201); }
  catch (error) { return payrollError(error); }
}
