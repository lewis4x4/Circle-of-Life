import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  isV2FormId,
  newAdmissionFormSchema,
  newIncidentFormSchema,
  newResidentFormSchema,
  type V2FormId,
} from "@/lib/v2-forms";

/**
 * `POST /api/v2/forms/[id]` — live V2 form submission handler.
 *
 * Each form id maps to an INSERT against the canonical Haven table for that
 * entity, run under the caller's session so RLS (incl. facility membership)
 * enforces who can write what. The handler:
 *
 * 1. Validates auth.
 * 2. Re-validates the body against the same Zod schema the form uses
 *    client-side (defense in depth).
 * 3. Looks up `organization_id` via the chosen facility (residents,
 *    incidents) or directly from the body in S10a follow-up if needed.
 * 4. Inserts and returns `{ id, listId }` so the client can redirect into
 *    the new record's V2 detail page.
 *
 * Map from UI severity (`low/medium/high/critical`) to the DB enum
 * (`level_1..4`) is pinned here — the UI keeps the human-readable labels.
 */

type SimpleResult<T> = { data: T | null; error: { message: string; code?: string } | null };
type FacilityRow = { id: string; organization_id: string };

const SEVERITY_MAP: Record<
  z.infer<typeof newIncidentFormSchema>["severity"],
  "level_1" | "level_2" | "level_3" | "level_4"
> = {
  low: "level_1",
  medium: "level_2",
  high: "level_3",
  critical: "level_4",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isV2FormId(id)) {
    return NextResponse.json({ error: "Unknown form id" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const formId = id as V2FormId;
  switch (formId) {
    case "new-resident":
      return handleNewResident(supabase, payload);
    case "new-admission":
      return handleNewAdmission(supabase, payload);
    case "new-incident":
      return handleNewIncident(supabase, user.id, payload);
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function loadFacilityOrg(
  supabase: ServerSupabase,
  facilityId: string,
): Promise<{ orgId: string } | { error: string; status: number }> {
  const result = (await supabase
    .from("facilities" as never)
    .select("id, organization_id")
    .eq("id" as never, facilityId as never)
    .is("deleted_at" as never, null as never)
    .maybeSingle()) as unknown as SimpleResult<FacilityRow>;
  if (result.error) {
    return { error: result.error.message, status: 500 };
  }
  if (!result.data) {
    return {
      error: "Facility not found or you do not have access.",
      status: 403,
    };
  }
  return { orgId: result.data.organization_id };
}

function rlsDenied(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42501" || /row-level security/i.test(error.message ?? "")
  );
}

async function handleNewResident(
  supabase: ServerSupabase,
  payload: unknown,
): Promise<NextResponse> {
  const parsed = newResidentFormSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const orgLookup = await loadFacilityOrg(supabase, data.facilityId);
  if ("error" in orgLookup) {
    return NextResponse.json({ error: orgLookup.error }, { status: orgLookup.status });
  }

  const insertResult = (await supabase
    .from("residents" as never)
    .insert({
      organization_id: orgLookup.orgId,
      facility_id: data.facilityId,
      first_name: data.firstName,
      last_name: data.lastName,
      date_of_birth: data.dateOfBirth,
      primary_diagnosis: data.primaryDiagnosis || null,
      status: "pending_admission",
    } as never)
    .select("id")
    .single()) as unknown as SimpleResult<{ id: string }>;

  if (insertResult.error || !insertResult.data) {
    const denied = rlsDenied(insertResult.error);
    return NextResponse.json(
      {
        error: denied
          ? "Forbidden — RLS denied facility access."
          : "Could not create resident",
        detail: insertResult.error?.message,
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      formId: "new-resident",
      recordId: insertResult.data.id,
      redirectTo: `/admin/residents/${insertResult.data.id}`,
    },
    { status: 201 },
  );
}

async function handleNewAdmission(
  supabase: ServerSupabase,
  payload: unknown,
): Promise<NextResponse> {
  const parsed = newAdmissionFormSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const orgLookup = await loadFacilityOrg(supabase, data.facilityId);
  if ("error" in orgLookup) {
    return NextResponse.json({ error: orgLookup.error }, { status: orgLookup.status });
  }

  const insertResult = (await supabase
    .from("admission_cases" as never)
    .insert({
      organization_id: orgLookup.orgId,
      facility_id: data.facilityId,
      resident_id: data.residentId,
      target_move_in_date: data.targetMoveInDate,
      notes: data.notes || null,
      status: "pending_clearance",
    } as never)
    .select("id")
    .single()) as unknown as SimpleResult<{ id: string }>;

  if (insertResult.error || !insertResult.data) {
    const denied = rlsDenied(insertResult.error);
    return NextResponse.json(
      {
        error: denied
          ? "Forbidden — RLS denied facility access."
          : "Could not create admission case",
        detail: insertResult.error?.message,
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      formId: "new-admission",
      recordId: insertResult.data.id,
      redirectTo: `/admin/admissions/${insertResult.data.id}`,
    },
    { status: 201 },
  );
}

async function handleNewIncident(
  supabase: ServerSupabase,
  userId: string,
  payload: unknown,
): Promise<NextResponse> {
  const parsed = newIncidentFormSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const orgLookup = await loadFacilityOrg(supabase, data.facilityId);
  if ("error" in orgLookup) {
    return NextResponse.json({ error: orgLookup.error }, { status: orgLookup.status });
  }

  const insertResult = (await supabase
    .from("incidents" as never)
    .insert({
      organization_id: orgLookup.orgId,
      facility_id: data.facilityId,
      resident_id: data.residentId || null,
      category: data.category,
      severity: SEVERITY_MAP[data.severity],
      status: "open",
      occurred_at: new Date(data.occurredAt).toISOString(),
      location_description: data.locationDescription || null,
      description: data.description,
      injury_occurred: data.injuryOccurred,
      ahca_reportable: data.ahcaReportable,
      reported_by: userId,
    } as never)
    .select("id")
    .single()) as unknown as SimpleResult<{ id: string }>;

  if (insertResult.error || !insertResult.data) {
    const denied = rlsDenied(insertResult.error);
    return NextResponse.json(
      {
        error: denied
          ? "Forbidden — RLS denied facility access."
          : "Could not create incident",
        detail: insertResult.error?.message,
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      formId: "new-incident",
      recordId: insertResult.data.id,
      redirectTo: `/admin/incidents/${insertResult.data.id}`,
    },
    { status: 201 },
  );
}
