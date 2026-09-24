import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { packetActionSchema } from "@/lib/payroll-packets/validation";
import { actOnPayrollPacket, getPacketDetail, PACKET_ROLES } from "@/lib/payroll-packets/server";
import { payrollBody, payrollError, payrollJson } from "@/lib/payroll-packets/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.detail" });
  if ("response" in auth) return auth.response;
  try { return payrollJson(await getPacketDetail(auth.actor, databaseUuidSchema.parse((await context.params).id))); }
  catch (error) { return payrollError(error); }
}
export async function PATCH(request: Request, context: Context) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.action" });
  if ("response" in auth) return auth.response;
  try { return payrollJson({ packet: await actOnPayrollPacket(auth.actor, databaseUuidSchema.parse((await context.params).id), packetActionSchema.parse(await payrollBody(request))) }); }
  catch (error) { return payrollError(error); }
}
