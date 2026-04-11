/**
 * GET    /api/admin/facilities/[facilityId]/surveys  — List survey history
 * POST   /api/admin/facilities/[facilityId]/surveys  — Create survey record
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { surveyHistorySchema } from "@/lib/validation/facility-admin";

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

// ── GET: List Survey History ──────────────────────────────────────

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

  // List surveys ordered by survey_date desc
  const { data: surveys, error } = await (admin as any)
    .from("facility_survey_history")
    .select(
      "id, survey_date, survey_type, result, citation_count, citation_details, poc_submitted_date, poc_accepted_date, surveyor_names, document_id, notes, created_at, created_by, updated_at",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("survey_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch surveys" }, { status: 500 });
  }

  return NextResponse.json({
    data: surveys ?? [],
  });
}

// ── POST: Create Survey Record ────────────────────────────────────

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

  const parsed = surveyHistorySchema.safeParse(body);
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
    const { data: doc } = await (admin as any)
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
    // Create survey
    const { data: survey, error: insertErr } = await (admin as any)
      .from("facility_survey_history")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        survey_date: data.survey_date,
        survey_type: data.survey_type,
        result: data.result,
        citation_count: data.citation_count,
        citation_details: data.citation_details ?? null,
        poc_submitted_date: data.poc_submitted_date ?? null,
        poc_accepted_date: data.poc_accepted_date ?? null,
        surveyor_names: data.surveyor_names ?? null,
        document_id: data.document_id ?? null,
        notes: data.notes ?? null,
        created_by: actor.id,
      } as Record<string, unknown>)
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: "Failed to create survey" }, { status: 500 });
    }

    return NextResponse.json({ data: survey }, { status: 201 });
  } catch (err) {
    console.error("[survey-create] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
