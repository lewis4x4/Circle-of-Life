import { NextRequest, NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { ensureForm1823Checklist, emitWorkflowEvent, syncLeadToApplicationPending } from "@/lib/workflows/workflow-events";

const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
] as const;

type MedicaidPipelineStage = "prospect" | "app_requested" | "pending" | "approved" | "denied" | "waitlist";

const MEDICAID_PIPELINE_STAGES: MedicaidPipelineStage[] = [
  "prospect",
  "app_requested",
  "pending",
  "approved",
  "denied",
  "waitlist",
];

type AnticipatedPayerSource =
  | "private_pay"
  | "medicaid_pending"
  | "medicaid_approved"
  | "ltc_insurance"
  | "va_benefits"
  | "other";

const ANTICIPATED_PAYER_SOURCES: AnticipatedPayerSource[] = [
  "private_pay",
  "medicaid_pending",
  "medicaid_approved",
  "ltc_insurance",
  "va_benefits",
  "other",
];

type AdmissionCaseSource =
  | "walk_in"
  | "hospital_discharge_no_referral"
  | "facility_transfer_no_referral"
  | "family_initiated"
  | "other";

const ADMISSION_CASE_SOURCES: AdmissionCaseSource[] = [
  "walk_in",
  "hospital_discharge_no_referral",
  "facility_transfer_no_referral",
  "family_initiated",
  "other",
];

type RequestBody = {
  facility_id?: string;
  resident_id?: string;
  referral_lead_id?: string | null;
  bed_id?: string | null;
  target_move_in_date?: string | null;
  notes?: string | null;
  /** Optional intake classification from the admissions form (e.g. long_term). */
  intake_program_type?: string | null;
  medicaid_pipeline_stage?: MedicaidPipelineStage;
  /** `draft` = save for later (no bed reservation; date optional). `submit` = open active case. */
  create_intent?: "draft" | "submit";
  anticipated_payer_source?: AnticipatedPayerSource | null;
  anticipated_payer_other?: string | null;
  /** Direct-intake admission channel (mirrors `admission_cases.source`). */
  source?: AdmissionCaseSource | null;
  source_other?: string | null;
};

function isOnOrAfterTodayYmd(ymd: string, facilityTimeZone: string): boolean {
  const trimmed = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const todayYmd = formatInTimeZone(new Date(), facilityTimeZone, "yyyy-MM-dd");
  return trimmed >= todayYmd;
}

export async function POST(request: NextRequest) {
  const actorResult = await requireAdminApiActor({ allowedRoles: ALLOWED_ROLES });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.facility_id || !body.resident_id) {
    return NextResponse.json({ error: "facility_id and resident_id are required" }, { status: 400 });
  }

  const intent: "draft" | "submit" = body.create_intent === "draft" ? "draft" : "submit";

  if (intent === "submit") {
    if (!body.target_move_in_date || !String(body.target_move_in_date).trim()) {
      return NextResponse.json({ error: "target_move_in_date is required" }, { status: 400 });
    }
  }

  if (
    body.anticipated_payer_source != null
    && !ANTICIPATED_PAYER_SOURCES.includes(body.anticipated_payer_source as AnticipatedPayerSource)
  ) {
    return NextResponse.json({ error: "Invalid anticipated payer source" }, { status: 400 });
  }

  if (
    body.medicaid_pipeline_stage !== undefined
    && !MEDICAID_PIPELINE_STAGES.includes(body.medicaid_pipeline_stage as MedicaidPipelineStage)
  ) {
    return NextResponse.json({ error: "Invalid Medicaid pipeline stage" }, { status: 400 });
  }

  if (
    body.source !== undefined
    && body.source !== null
    && String(body.source).trim() !== ""
    && !ADMISSION_CASE_SOURCES.includes(body.source as AdmissionCaseSource)
  ) {
    return NextResponse.json({ error: "Invalid admission source" }, { status: 400 });
  }

  const canAccessFacility = await actorCanAccessFacility(actor, body.facility_id);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await actor.admin
    .from("facilities")
    .select("id, organization_id, timezone")
    .eq("id", body.facility_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility?.organization_id) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const facilityTz = typeof facility.timezone === "string" && facility.timezone.trim()
    ? facility.timezone.trim()
    : "America/New_York";

  if (
    intent === "submit"
    && body.target_move_in_date != null
    && String(body.target_move_in_date).trim()
    && !isOnOrAfterTodayYmd(String(body.target_move_in_date), facilityTz)
  ) {
    return NextResponse.json({ error: "target_move_in_date must be today or a future date" }, { status: 400 });
  }

  const { data: resident, error: residentError } = await actor.admin
    .from("residents")
    .select("id, facility_id")
    .eq("id", body.resident_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (residentError || !resident || resident.facility_id !== body.facility_id) {
    return NextResponse.json({ error: "Resident not found in facility" }, { status: 400 });
  }

  if (body.referral_lead_id) {
    const { data: lead, error: leadError } = await actor.admin
      .from("referral_leads")
      .select("id, facility_id")
      .eq("id", body.referral_lead_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (leadError || !lead || lead.facility_id !== body.facility_id) {
      return NextResponse.json({ error: "Referral lead not found in facility" }, { status: 400 });
    }
  }

  const payerSource =
    body.anticipated_payer_source && String(body.anticipated_payer_source).trim()
      ? (body.anticipated_payer_source as AnticipatedPayerSource)
      : null;
  const payerOther =
    payerSource === "other" ? (body.anticipated_payer_other?.trim() || null) : null;

  const admissionCaseSource =
    body.source != null && String(body.source).trim()
      ? (body.source as AdmissionCaseSource)
      : null;
  const admissionCaseSourceOther =
    admissionCaseSource === "other" ? (body.source_other?.trim() || null) : null;

  const status = intent === "draft" ? "draft" : "pending_clearance";
  const bedId = intent === "draft" ? null : (body.bed_id ?? null);
  const moveInDate =
    intent === "draft"
      ? (body.target_move_in_date?.trim() || null)
      : (body.target_move_in_date?.trim() || null);

  const { data: inserted, error: insertError } = await actor.admin
    .from("admission_cases")
    .insert({
      organization_id: facility.organization_id,
      facility_id: body.facility_id,
      resident_id: body.resident_id,
      referral_lead_id: body.referral_lead_id ?? null,
      bed_id: bedId,
      target_move_in_date: moveInDate,
      notes: body.notes ?? null,
      intake_program_type: body.intake_program_type ?? null,
      medicaid_pipeline_stage: body.medicaid_pipeline_stage ?? "prospect",
      anticipated_payer_source: payerSource,
      anticipated_payer_other: payerOther,
      source: admissionCaseSource,
      source_other: admissionCaseSourceOther,
      status,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("id, organization_id, facility_id, resident_id, referral_lead_id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create admission case" }, { status: 500 });
  }

  if (intent === "submit") {
    await ensureForm1823Checklist(actor.admin, {
      organizationId: inserted.organization_id,
      facilityId: inserted.facility_id,
      admissionCaseId: inserted.id,
      actorId: actor.id,
    });
  }

  if (intent === "submit" && inserted.referral_lead_id) {
    await syncLeadToApplicationPending(actor.admin, {
      leadId: inserted.referral_lead_id,
      actorId: actor.id,
    });

    await emitWorkflowEvent(actor.admin, {
      organization_id: inserted.organization_id,
      facility_id: inserted.facility_id,
      referral_lead_id: inserted.referral_lead_id,
      admission_case_id: inserted.id,
      resident_id: inserted.resident_id,
      event_type: "referral_admission_started",
      source_module: "admissions",
      event_key: `referral-admission-started:${inserted.id}`,
      created_by: actor.id,
      payload_json: {
        status: "pending_clearance",
        target_move_in_date: body.target_move_in_date ?? null,
        bed_id: body.bed_id ?? null,
      },
    });
  }

  return NextResponse.json({ id: inserted.id });
}
