import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiActor } from "@/lib/admin/api-auth";

const schema = z.object({ ticketId: z.uuid(), residentId: z.uuid(), foodLevel: z.number().int().min(0).max(7), liquidLevel: z.number().int().min(0).max(4), allergensConfirmed: z.literal(true) }).strict();
export async function POST(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: ["dietary", "dietary_aide", "manager", "owner", "org_admin", "facility_admin"] });
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete all tray checks." }, { status: 400 });
  const { data, error } = await auth.actor.admin.rpc("haven_record_tray_pass" as never, { p_ticket_id: parsed.data.ticketId, p_resident_id: parsed.data.residentId, p_food_level: parsed.data.foodLevel, p_liquid_level: parsed.data.liquidLevel, p_actor_id: auth.actor.id } as never);
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ id: data });
}
