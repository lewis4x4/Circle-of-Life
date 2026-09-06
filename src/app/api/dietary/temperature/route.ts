import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminApiActor, actorCanAccessFacility } from "@/lib/admin/api-auth";

const schema = z.object({ id: z.uuid(), facilityId: z.uuid(), item: z.string().trim().min(1).max(200), logType: z.enum(["hot_hold","cold_hold","cooking","cooling","reheating","receiving","fridge_temp","freezer_temp","dishmachine","sanitizer"]), temperature: z.number().finite().min(-100).max(500), minimum: z.number().finite().min(-100).max(500), maximum: z.number().finite().min(-100).max(500), correctiveAction: z.string().trim().max(2000) }).strict().refine((v) => v.minimum <= v.maximum, "Minimum must not exceed maximum");
export async function POST(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: ["dietary", "dietary_aide", "manager", "owner", "org_admin", "facility_admin"] });
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the item, measured temperature and approved limits." }, { status: 400 });
  const p = parsed.data;
  const allowed = await actorCanAccessFacility(auth.actor, p.facilityId);
  if (!allowed) return NextResponse.json({ error: "No access to facility" }, { status: 403 });
  const inRange = p.temperature >= p.minimum && p.temperature <= p.maximum;
  if (!inRange && !p.correctiveAction) return NextResponse.json({ error: "Record the corrective action for an out-of-range reading." }, { status: 400 });
  const payload = { id: p.id, organization_id: auth.actor.organization_id, facility_id: p.facilityId, log_type: p.logType, item: p.item, temperature_f: p.temperature, threshold_min_f: p.minimum, threshold_max_f: p.maximum, in_safe_range: inRange, corrective_action: p.correctiveAction || null, logged_by: auth.actor.id };
  type HaccpDatabase = { public: { Tables: { haccp_logs: { Row: typeof payload; Insert: typeof payload; Update: never; Relationships: [] } }; Views: Record<never, never>; Functions: Record<never, never> } };
  const client = auth.actor.admin as unknown as SupabaseClient<HaccpDatabase>;
  const { data, error } = await client.from("haccp_logs").insert(payload).select("id").single();
  if (error?.code === "23505") {
    const { data: prior, error: lookupError } = await client.from("haccp_logs").select("*")
      .eq("id", p.id).eq("organization_id", auth.actor.organization_id).eq("facility_id", p.facilityId).eq("logged_by", auth.actor.id).maybeSingle();
    const row = prior as Record<string, unknown> | null;
    if (!lookupError && row && Object.entries(payload).every(([key,value]) => typeof value === "number" ? Number(row[key]) === value : row[key] === value)) {
      return NextResponse.json({ id: p.id, replay: true });
    }
    return NextResponse.json({ error: "This receipt belongs to a different saved reading. Review the existing temperature log before recording a new measurement." }, { status: 409 });
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Reading was not saved" }, { status: 409 });
  return NextResponse.json({ id: (data as { id: string }).id });
}
