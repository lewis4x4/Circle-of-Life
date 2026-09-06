import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

type PassRow = { id: string; facility_id: string; organization_id: string; administered_by: string; status: string; deleted_at: string | null };
type PassDatabase = { public: { Tables: { med_passes: { Row: PassRow; Insert: never; Update: never; Relationships: [] } }; Views: Record<never, never>; Functions: Record<never, never> } };
import { requireAdminApiActor, actorCanAccessFacility } from "@/lib/admin/api-auth";
import { verifyWitnessCredentials } from "@/lib/supabase/witness-auth";
import { checkFailureRateLimit, recordFailureRateLimit, clearFailureRateLimit } from "@/lib/security/in-memory-failure-rate-limit";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) }).strict();
const limits = { maxFailures: 5, windowMs: 10 * 60 * 1000 };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiActor({ allowedRoles: ["nurse", "caregiver", "med_tech"] });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { id } = await params;
  let body;
  try { body = bodySchema.safeParse(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.success) return NextResponse.json({ error: "Witness email and password are required" }, { status: 400 });
  const { data: pass, error: passError } = await (actor.admin as unknown as SupabaseClient<PassDatabase>).from("med_passes").select("id,facility_id,organization_id,administered_by,status")
    .eq("id", id).eq("organization_id", actor.organization_id).is("deleted_at", null).maybeSingle();
  if (passError || !pass || pass.administered_by !== actor.id || !(await actorCanAccessFacility(actor, pass.facility_id))) {
    return NextResponse.json({ error: "Pass not found" }, { status: 404 });
  }
  if (!["pending", "overdue"].includes(pass.status)) return NextResponse.json({ error: "Pass is no longer pending" }, { status: 409 });
  const key = `med-pass-witness:${actor.id}`;
  const rate = checkFailureRateLimit(key, limits);
  if (!rate.allowed) return NextResponse.json({ error: "Too many failed verification attempts" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let verification;
  try { verification = await verifyWitnessCredentials(body.data.email, body.data.password); }
  catch { return NextResponse.json({ error: "Witness verification unavailable" }, { status: 503 }); }
  if (verification.error || !verification.data.user) {
    recordFailureRateLimit(key, limits);
    return NextResponse.json({ error: "Invalid witness credentials" }, { status: 401 });
  }
  clearFailureRateLimit(key);
  if (verification.data.user.id === actor.id) return NextResponse.json({ error: "A different staff member must witness this pass" }, { status: 400 });
  const { data, error } = await actor.admin.rpc("record_verified_med_pass_witness", {
    p_pass_id: id, p_actor_id: actor.id, p_witness_id: verification.data.user.id,
  });
  if (error || !data) return NextResponse.json({ error: "Witness must be active clinical staff with access to this facility, and the pass must still be pending" }, { status: 409 });
  return NextResponse.json({ ok: true, witnessSignatureId: data });
}
