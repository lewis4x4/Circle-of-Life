import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { policyRequestSchema } from "@/lib/payroll-packets/validation";
import { getPacketPolicy, savePacketPolicy, PACKET_ROLES } from "@/lib/payroll-packets/server";
import { payrollBody, payrollError, payrollJson } from "@/lib/payroll-packets/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.policy" });
  if ("response" in auth) return auth.response;
  try { return payrollJson({ policy: await getPacketPolicy(auth.actor, databaseUuidSchema.parse(new URL(request.url).searchParams.get("facility_id"))) }); }
  catch (error) { return payrollError(error); }
}
export async function PUT(request: Request) {
  const auth = await requireCurrentApiActor({ allowedRoles: ["owner", "org_admin"], scope: "payroll-packets.policy.save" });
  if ("response" in auth) return auth.response;
  try { return payrollJson({ policy: await savePacketPolicy(auth.actor, policyRequestSchema.parse(await payrollBody(request))) }); }
  catch (error) { return payrollError(error); }
}
