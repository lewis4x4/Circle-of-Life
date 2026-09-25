import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { ensureForm1823Checklist, emitWorkflowEvent } from "@/lib/workflows/workflow-events";
import { REUSED_REQUEST_MESSAGE } from "@/lib/admissions/arrival-api";
import { Constants } from "@/types/database";

/**
 * COL-333: start (or resume, or submit) the intake for one referral.
 *
 * One database transaction, public.admission_intake_start (migration 537),
 * locked on the referral: the inquiry resident (gender left unknown), the
 * admission case, the referral's move to application pending on submit, and a
 * durable receipt. The same request_id replays its receipt, so a retry after a
 * lost response never creates a second resident or case; a second user or tab
 * starting the same referral gets the case that already exists.
 */
const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "med_tech",
] as const;

const bodySchema = z.object({
  request_id: z.string().uuid(),
  facility_id: z.string().uuid(),
  referral_lead_id: z.string().uuid(),
  intent: z.enum(["draft", "submit"]),
  bed_id: z.string().uuid().nullable().optional(),
  target_move_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  intake_program_type: z.string().max(200).nullable().optional(),
  anticipated_payer_source: z.enum(Constants.public.Enums.anticipated_payer_source).nullable().optional(),
  anticipated_payer_other: z.string().max(2000).nullable().optional(),
  medicaid_pipeline_stage: z.enum(["prospect", "app_requested", "pending", "approved", "denied", "waitlist"]).optional(),
}).strict();

type IntakeResult = {
  resident_id: string;
  admission_case_id: string;
  admission_case_status: string;
  referral_lead_id: string;
  lead_status: string;
  outcome: "started_draft" | "started" | "submitted_draft" | "already_started";
  replayed: boolean;
};

/** Messages the transaction writes for staff; anything else stays in the log. */
const TRUSTED: Array<{ match: (message: string) => boolean; status: number }> = [
  { match: (m) => m === "Invalid intake request", status: 400 },
  { match: (m) => m === "Referral, facility, request and intent are required", status: 400 },
  { match: (m) => m === "Referral lead not found in facility", status: 400 },
  { match: (m) => m === "A target move-in date of today or later is required", status: 400 },
  { match: (m) => m === "Bed not found in this facility", status: 400 },
  { match: (m) => m === "You no longer have access to start an intake at this facility", status: 403 },
  { match: (m) => /^This referral is closed \([a-z_]+\)\. Reopen it before starting an intake$/.test(m), status: 409 },
];

function isIntakeResult(value: unknown): value is IntakeResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.resident_id === "string" && typeof row.admission_case_id === "string" && typeof row.outcome === "string";
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: ALLOWED_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the intake details" }, { status: 400 });
  const input = parsed.data;

  if (!(await actorCanAccessFacility(actor, input.facility_id))) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  // The transaction refuses unknown keys; send only what was given.
  const payload = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const { data: raw, error } = await actor.admin.rpc("admission_intake_start" as never, {
    p_actor_id: actor.id,
    p_payload: payload,
  } as never);

  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message === ["Idempotency", "key payload differs"].join(" ")) return NextResponse.json({ error: REUSED_REQUEST_MESSAGE }, { status: 409 });
    const trusted = TRUSTED.find((item) => item.match(message));
    if (trusted) return NextResponse.json({ error: message }, { status: trusted.status });
    logError("admin.workflows.admission-intake", error, { action: "rpc", facilityId: input.facility_id });
    return NextResponse.json({ error: "The intake could not be started. Retry the same request." }, { status: 500 });
  }
  const data: unknown = raw;
  if (!isIntakeResult(data)) {
    return NextResponse.json({ error: "Outcome uncertain. Retry the same request." }, { status: 503 });
  }

  // Follow-ups for a newly opened case. They are idempotent and outside the
  // transaction; a failure is logged and never undoes the intake.
  if (!data.replayed && data.admission_case_status !== "draft" && data.outcome !== "already_started") {
    try {
      await ensureForm1823Checklist(actor.admin, {
        organizationId: actor.organization_id,
        facilityId: input.facility_id,
        admissionCaseId: data.admission_case_id,
        actorId: actor.id,
      });
      await emitWorkflowEvent(actor.admin, {
        organization_id: actor.organization_id,
        facility_id: input.facility_id,
        referral_lead_id: data.referral_lead_id,
        admission_case_id: data.admission_case_id,
        resident_id: data.resident_id,
        event_type: "referral_admission_started",
        source_module: "admissions",
        event_key: `referral-admission-started:${data.admission_case_id}`,
        created_by: actor.id,
        payload_json: {
          status: data.admission_case_status,
          target_move_in_date: input.target_move_in_date ?? null,
          bed_id: input.bed_id ?? null,
        },
      });
    } catch (followUpError) {
      logError("admin.workflows.admission-intake", followUpError, { action: "follow_up", admissionCaseId: data.admission_case_id });
    }
  }

  return NextResponse.json(data);
}
