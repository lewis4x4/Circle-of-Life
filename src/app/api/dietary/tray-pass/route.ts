import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";

const TRUSTED_TRAY_ERRORS = new Set([
  "Not permitted to pass trays",
  "No access to this facility",
  "Tray cannot be passed from its current status",
  "No current active diet order. Contact the nurse.",
  "Checked levels do not match the current order. Contact the nurse.",
  "Tray snapshot differs from the current diet order. Regenerate the tray before serving.",
]);

const schema = z.object({ ticketId: z.uuid(), residentId: z.uuid(), foodLevel: z.number().int().min(0).max(7), liquidLevel: z.number().int().min(0).max(4), allergensConfirmed: z.literal(true) }).strict();
export async function POST(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: ["dietary", "dietary_aide", "manager", "owner", "org_admin", "facility_admin"] });
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete all tray checks." }, { status: 400 });
  const { data, error } = await auth.actor.admin.rpc("haven_record_tray_pass" as never, { p_ticket_id: parsed.data.ticketId, p_resident_id: parsed.data.residentId, p_food_level: parsed.data.foodLevel, p_liquid_level: parsed.data.liquidLevel, p_actor_id: auth.actor.id } as never);
  if (error) {
    logError("dietary.tray-pass.create", error, {
      action: "rpc",
      ticketId: parsed.data.ticketId,
    });
    const responseError = TRUSTED_TRAY_ERRORS.has(error.message)
      ? error.message
      : "Tray verification could not be saved. Refresh the tray and retry.";
    return NextResponse.json({ error: responseError }, { status: 409 });
  }
  return NextResponse.json({ id: data });
}
