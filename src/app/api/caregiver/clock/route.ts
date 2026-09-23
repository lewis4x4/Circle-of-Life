import { NextResponse } from "next/server";

import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { FRONT_DOOR_CLOCK_COPY, timeclockFlagForFacility } from "@/lib/timeclock/facility-flag";
import type { Database } from "@/types/database";

type ClockBody = { action: "in"; facility_id: string } | { action: "out"; time_record_id: string };

function parseBody(body: unknown): ClockBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.action === "in" && typeof record.facility_id === "string" && UUID_STRING_RE.test(record.facility_id)) {
    return { action: "in", facility_id: record.facility_id };
  }
  if (record.action === "out" && typeof record.time_record_id === "string" && UUID_STRING_RE.test(record.time_record_id)) {
    return { action: "out", time_record_id: record.time_record_id };
  }
  return null;
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/caregiver/clock: the mobile punch behind /caregiver/clock.
 * One clock (spec 40 §1): where the facility's timeclock is on, staff punch at
 * the front-door kiosk and this route writes nothing to `time_records` (409).
 * Writes go through the caller's own session, so RLS decides who may punch
 * where, exactly as the page's direct writes did before.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: "Invalid clock request" }, { status: 400, headers: NO_STORE });

  const auth = await requireCurrentApiActor({ scope: "caregiver.clock" });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  let facilityId: string;
  let openRecordId: string | null = null;
  if (body.action === "in") {
    facilityId = body.facility_id;
  } else {
    const record = await actor.client
      .from("time_records")
      .select("id, facility_id")
      .eq("id", body.time_record_id)
      .is("clock_out", null)
      .is("deleted_at", null)
      .maybeSingle();
    if (record.error) {
      logError("caregiver.clock", record.error, { action: "read_open_punch" });
      return NextResponse.json({ error: "Could not load your punch. Try again." }, { status: 500, headers: NO_STORE });
    }
    if (!record.data) return NextResponse.json({ error: "No open punch to close." }, { status: 404, headers: NO_STORE });
    facilityId = record.data.facility_id;
    openRecordId = record.data.id;
  }

  const flag = await timeclockFlagForFacility(actor.admin, actor.organizationId, facilityId);
  if (flag === "on") {
    return NextResponse.json({ error: FRONT_DOOR_CLOCK_COPY.refusal, code: "front_door_clock" }, { status: 409, headers: NO_STORE });
  }
  if (flag === "unknown") {
    return NextResponse.json({ error: "Time clock is temporarily unavailable. Try again." }, { status: 503, headers: NO_STORE });
  }

  const now = new Date().toISOString();
  if (openRecordId) {
    const update = await actor.client
      .from("time_records")
      .update({ clock_out: now, clock_out_method: "mobile", updated_by: actor.id })
      .eq("id", openRecordId)
      .is("deleted_at", null);
    if (update.error) {
      logError("caregiver.clock", update.error, { action: "clock_out" });
      return NextResponse.json({ error: "Clock out failed." }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const staff = await actor.client
    .from("staff")
    .select("id, organization_id")
    .eq("user_id", actor.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (staff.error) {
    logError("caregiver.clock", staff.error, { action: "read_staff" });
    return NextResponse.json({ error: "Clock in failed." }, { status: 500, headers: NO_STORE });
  }
  if (!staff.data) {
    return NextResponse.json({ error: "Your login is not linked to a staff record yet. Ask your administrator to link it." }, { status: 422, headers: NO_STORE });
  }
  const row: Database["public"]["Tables"]["time_records"]["Insert"] = {
    staff_id: staff.data.id,
    facility_id: facilityId,
    organization_id: staff.data.organization_id,
    clock_in: now,
    clock_in_method: "mobile",
    approved: false,
    created_by: actor.id,
  };
  const insert = await actor.client.from("time_records").insert(row).select("id").single();
  if (insert.error) {
    logError("caregiver.clock", insert.error, { action: "clock_in" });
    return NextResponse.json({ error: "Clock in failed." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, id: insert.data.id }, { headers: NO_STORE });
}
