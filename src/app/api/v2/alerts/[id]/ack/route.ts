import { NextResponse } from "next/server";
import { z } from "zod";

import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { createClient } from "@/lib/supabase/server";

const ackBodySchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
});

const IDEMPOTENCY_WINDOW_MS = 60_000;

type AuditRow = { id: string; created_at: string };
type QueryErr = { message: string; code?: string };
type ResultSingle<T> = { data: T | null; error: QueryErr | null };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: alertId } = await params;
  if (!z.string().uuid().safeParse(alertId).success) {
    return NextResponse.json({ error: "Invalid alert id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const appRole = getAppRoleFromClaims(user);
  if (!appRole) {
    return NextResponse.json({ error: "Missing app_role claim" }, { status: 403 });
  }

  let payload: z.infer<typeof ackBodySchema>;
  try {
    payload = ackBodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        detail: error instanceof z.ZodError ? error.flatten() : String(error),
      },
      { status: 400 },
    );
  }

  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();

  // Generated Supabase types lag migration 209 (`alert_audit_log`); cast the
  // table ref and the response shapes instead of widening the Database type
  // in this slice. Regenerating types is tracked separately (TS1 regen).
  const alertAuditTable = () => supabase.from("alert_audit_log" as never);

  const dedupe = (await alertAuditTable()
    .select("id, created_at")
    .eq("alert_id" as never, alertId as never)
    .eq("actor_id" as never, user.id as never)
    .eq("action" as never, "ack" as never)
    .gte("created_at" as never, since as never)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as ResultSingle<AuditRow>;

  if (dedupe.error) {
    return NextResponse.json(
      { error: "Dedupe check failed", detail: dedupe.error.message },
      { status: 500 },
    );
  }

  if (dedupe.data) {
    return NextResponse.json(
      { ok: true, deduped: true, audit_id: dedupe.data.id },
      { status: 200 },
    );
  }

  const insertResult = (await alertAuditTable()
    .insert({
      organization_id: payload.organizationId,
      facility_id: payload.facilityId,
      alert_id: alertId,
      action: "ack",
      actor_id: user.id,
      actor_role: appRole,
      note: payload.note ?? null,
    } as never)
    .select("id, created_at")
    .single()) as unknown as ResultSingle<AuditRow>;

  if (insertResult.error || !insertResult.data) {
    const message = insertResult.error?.message ?? "";
    const denied =
      insertResult.error?.code === "42501" || /row-level security/i.test(message);
    return NextResponse.json(
      {
        error: denied
          ? "Forbidden — no access to this alert's facility"
          : "Could not record ACK",
        detail: message,
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      deduped: false,
      audit_id: insertResult.data.id,
      created_at: insertResult.data.created_at,
    },
    { status: 201 },
  );
}
