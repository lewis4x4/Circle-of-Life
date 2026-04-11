/**
 * GET    /api/admin/facilities/[facilityId]/timeline  — List timeline events
 * POST   /api/admin/facilities/[facilityId]/timeline  — Create timeline event
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { timelineEventSchema } from "@/lib/validation/facility-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── Helper: authenticate + get actor ──────────────────────────────

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return profile ? { ...profile, admin } : null;
}

// ── GET: List Timeline Events ─────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;
  const admin = actor.admin;

  // Verify facility exists and belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // List events ordered by event_date desc
  const { data: events, error } = await admin
    .from("facility_timeline_events")
    .select("id, event_date, event_type, title, description, document_id, created_at, created_by")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("event_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch timeline events" }, { status: 500 });
  }

  return NextResponse.json({
    data: events ?? [],
  });
}

// ── POST: Create Timeline Event ───────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;

  // Authorization: owner/org_admin only
  if (!["owner", "org_admin"].includes(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = timelineEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const admin = actor.admin;

  // Verify facility exists and belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Verify document exists (if provided)
  if (data.document_id) {
    const { data: doc } = await admin
      .from("facility_documents")
      .select("id")
      .eq("id", data.document_id)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
  }

  try {
    // Create event
    const { data: event, error: insertErr } = await admin
      .from("facility_timeline_events")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        event_date: data.event_date,
        event_type: data.event_type,
        title: data.title,
        description: data.description ?? null,
        document_id: data.document_id ?? null,
        created_by: actor.id,
      } as Record<string, unknown>)
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: "Failed to create timeline event" }, { status: 500 });
    }

    return NextResponse.json({ data: event }, { status: 201 });
  } catch (err) {
    console.error("[timeline-create] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
