import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentApiActor, revalidateCurrentApiActor, type CurrentApiActor, type CurrentApiActorResult } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema as uuid } from "@/lib/operations/database-uuid";
import { validateResidentIntakeBytes } from "@/lib/resident-intake/source-bytes";
import {
  BENEFITS_BUCKET, BENEFITS_MAX_FILE_BYTES, BENEFITS_MIME_TYPES, BENEFITS_PROGRAMS, BENEFITS_STATUSES,
  benefitsAccessSchema, benefitsCommandSchema, benefitsEventSchema, benefitsFundingSchema,
  benefitsReceiptSchema, benefitsRequirementSchema, benefitsScreeningSchema, benefitsSubmissionSchema,
  createBenefitsCaseSchema, type BenefitsDetail, type BenefitsDocument, BENEFITS_RULE_KEYS, benefitsRuleSetSchema,
  admissionGateSchema, overrideAdmissionScreeningSchema, recordAdmissionScreeningSchema, SCREENING_COVERAGE, SCREENING_RESULTS, SCREENING_RESPONDENTS,
  completeRecheckSchema, startSweepSchema, startPromptCaseSchema, dismissPromptSchema, boardCommandSchema, contactSaveSchema, BOARD_STEPS, CONTACT_AGENCIES,
} from "./contracts";

export const BENEFITS_STAFF_ROLES = ["owner", "org_admin", "facility_admin", "manager", "admin_assistant", "coordinator", "med_tech"] as const;
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const permissionSchema = z.object({ can_write: z.boolean(), can_review: z.boolean(), can_manage_access: z.boolean() });
const caseSchema = z.object({
  id: uuid, organization_id: uuid, facility_id: uuid, resident_id: uuid, admission_case_id: uuid.nullable(),
  program: z.enum(BENEFITS_PROGRAMS), status: z.enum(BENEFITS_STATUSES), revision: z.number().int().positive(),
  next_action: z.string().nullable(), assigned_to: uuid.nullable(), due_date: z.string().nullable(), closure_reason: z.string().nullable(),
  screening: benefitsScreeningSchema, funding: benefitsFundingSchema, created_at: z.string(), updated_at: z.string(),
  created_by: uuid, resident_name: z.string(), facility_name: z.string(), assignee_name: z.string().nullable(),
  resident_status: z.string().nullable().optional(), resident_facility_id: uuid.nullable().optional(), resident_facility_name: z.string().nullable().optional(),
  needs_rebind: z.boolean().optional(), renewal_date: z.string().nullable().optional(),
}).passthrough();
export const benefitsDocumentRowSchema = z.object({
  id: uuid, case_id: uuid, filename: z.string().min(1).max(255), mime_type: z.enum(BENEFITS_MIME_TYPES),
  size_bytes: z.number().int().positive().max(BENEFITS_MAX_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storage_path: z.string().min(1), status: z.enum(["reserved", "ready"]), document_type: z.string(),
  template_version: z.string().nullable(), created_at: z.string(), created_by: uuid,
  voided_at: z.string().nullable().optional(), voided_by: uuid.nullable().optional(), void_reason: z.string().nullable().optional(),
}).passthrough();
const rowStamp = { id: uuid, case_id: uuid, created_at: z.string(), created_by: uuid };
const detailSchema = z.object({
  case: caseSchema, permissions: permissionSchema,
  requirements: z.array(benefitsRequirementSchema.extend({ id: uuid, case_id: uuid, reviewed_by: uuid.nullable(), reviewed_at: z.string().nullable(), updated_at: z.string() }).passthrough()),
  documents: z.array(benefitsDocumentRowSchema),
  events: z.array(benefitsEventSchema.extend(rowStamp).passthrough()),
  submissions: z.array(benefitsSubmissionSchema.extend({ ...rowStamp, manifest: z.array(z.object({ id: uuid, sha256: z.string(), filename: z.string() })) }).passthrough()),
  receipts: z.array(benefitsReceiptSchema.extend(rowStamp).passthrough()),
  history: z.array(z.object({ ...rowStamp, action: z.string(), payload: z.record(z.string(), z.unknown()), revision: z.number().int() }).passthrough()),
  history_has_more: z.boolean(),
});
const commandReply = z.object({ case_id: uuid, revision: z.number().int().positive(), document: benefitsDocumentRowSchema.optional() }).passthrough();

export function benefitsFailure(status = 503, message = "Benefits information could not be verified. Please retry.") {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
function rpcFailure(error: { code?: string }) {
  if (error.code === "42501" || error.code === "P0002") return benefitsFailure(404, "Benefits case or access is unavailable.");
  if (["23505", "P0409", "P0001", "23514", "55000"].includes(error.code ?? "")) return benefitsFailure(409, "This action conflicts with the current case or its evidence. Refresh and review the requirements.");
  if (["22023", "22P02", "22007", "22008"].includes(error.code ?? "")) return benefitsFailure(400, "Some benefits fields are invalid.");
  return benefitsFailure();
}
export function requireBenefitsActor() {
  return requireCurrentApiActor({ allowedRoles: BENEFITS_STAFF_ROLES, scope: "benefits.authority" });
}
export async function revalidateBenefitsActor(actor: CurrentApiActor): Promise<CurrentApiActorResult> {
  const current = await revalidateCurrentApiActor(actor, { allowedRoles: BENEFITS_STAFF_ROLES, scope: "benefits.authority.revalidate" });
  if ("response" in current) return current;
  if (current.actor.id !== actor.id || current.actor.organizationId !== actor.organizationId || current.actor.appRole !== actor.appRole) {
    return { response: benefitsFailure(404, "Benefits access has changed. Refresh before continuing.") };
  }
  return current;
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  if (Number(request.headers.get("content-length") || 0) > 128 * 1024) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 128 * 1024) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return null; }
}
async function rpc(actor: CurrentApiActor, name: string, params: Record<string, unknown> = {}) {
  return actor.client.rpc(name as never, params as never);
}
export async function loadBenefitsDetail(actor: CurrentApiActor, id: string): Promise<{ detail: BenefitsDetail } | { response: NextResponse }> {
  if (!uuid.safeParse(id).success) return { response: benefitsFailure(400, "Invalid case.") };
  const current = await revalidateBenefitsActor(actor);
  if ("response" in current) return current;
  const result = await rpc(current.actor, "benefits_case_detail", { p_case_id: id });
  if (result.error) return { response: rpcFailure(result.error) };
  const parsed = detailSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.case.id !== id || parsed.data.case.organization_id !== actor.organizationId) return { response: benefitsFailure() };
  return { detail: parsed.data };
}
export async function listBenefitsCases(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const filters = z.object({ facility_id: uuid.optional(), resident_id: uuid.optional(), status: z.enum(BENEFITS_STATUSES).optional(), assigned_to: uuid.optional(), before: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(query);
  if (!filters.success) return benefitsFailure(400, "Invalid case filters.");
  const result = await rpc(auth.actor, "benefits_case_list", { p_filters: filters.data });
  if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ cases: z.array(caseSchema), next_cursor: z.string().nullable() }).safeParse(result.data);
  if (!parsed.success || parsed.data.cases.some(row => row.organization_id !== auth.actor.organizationId)) return benefitsFailure();
  return NextResponse.json(parsed.data, { headers: noStore });
}
export async function createBenefitsCase(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = createBenefitsCaseSchema.safeParse(await readBody(request));
  if (!parsed.success) return benefitsFailure(400, "Select a resident and program.");
  const result = await rpc(auth.actor, "benefits_case_create", { p_resident_id: parsed.data.resident_id, p_admission_case_id: parsed.data.admission_case_id ?? null, p_program: parsed.data.program, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success) return benefitsFailure();
  return NextResponse.json(reply.data, { status: 201, headers: noStore });
}
export async function getBenefitsCase(_request: Request, id: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const result = await loadBenefitsDetail(auth.actor, id);
  return "response" in result ? result.response : NextResponse.json(result.detail, { headers: noStore });
}
export async function commandBenefitsCase(request: Request, id: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = benefitsCommandSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(id).success || !parsed.success) return benefitsFailure(400, "Review the required fields and dates.");
  const result = await rpc(auth.actor, "benefits_case_command", { p_case_id: id, p_action: parsed.data.action, p_payload: parsed.data.payload, p_expected_revision: parsed.data.expected_revision, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success || reply.data.case_id !== id) return benefitsFailure();
  return NextResponse.json(reply.data, { headers: noStore });
}
export async function getBenefitsOptions(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid.optional(), resident_id: uuid.optional(), query: z.string().max(100).optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Invalid search.");
  const result = await rpc(auth.actor, "benefits_options", { p_facility_id: query.data.facility_id ?? null, p_query: query.data.query || query.data.resident_id || "" });
  if (result.error) return rpcFailure(result.error);
  const named = z.object({ id: uuid, name: z.string() });
  const parsed = z.object({ facilities: z.array(named), residents: z.array(named.extend({ facility_id: uuid })), assignees: z.array(named.extend({ facility_id: uuid })), can_manage_access: z.boolean(),
    uncased_medicaid_residents: z.array(named.extend({ facility_id: uuid, payer_type: z.string(), suggested_program: z.enum(BENEFITS_PROGRAMS), medicaid_authorization_end: z.string().nullable() })).default([]), actor_id: uuid.optional() }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
const ruleRowSchema = z.object({ id: uuid, organization_id: uuid, rule_key: z.enum(BENEFITS_RULE_KEYS), value: z.unknown(), effective_from: z.string(), reason: z.string(), created_by: uuid.nullable(), created_at: z.string() });
export async function getBenefitsRules() {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const result = await rpc(auth.actor, "benefits_rules_list"); if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ can_manage: z.boolean(), as_of: z.string(), rules: z.array(z.object({ rule_key: z.enum(BENEFITS_RULE_KEYS), current: ruleRowSchema.nullable(), value: z.unknown(), scheduled: z.array(ruleRowSchema), history_count: z.number().int() })) }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function setBenefitsRule(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = benefitsRuleSetSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "Provide the rule, its new value, the date it takes effect and a reason.");
  const result = await rpc(auth.actor, "benefits_rule_set", { p_payload: parsed.data });
  if (result.error) return rpcFailure(result.error);
  const reply = ruleRowSchema.safeParse(result.data); if (!reply.success) return benefitsFailure();
  return NextResponse.json(reply.data, { status: 201, headers: noStore });
}
export async function rebindBenefitsCase(request: Request, id: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const body = z.object({ request_id: uuid }).strict().safeParse(await readBody(request));
  if (!uuid.safeParse(id).success || !body.success) return benefitsFailure(400, "Invalid rebind request.");
  const result = await rpc(auth.actor, "benefits_case_rebind", { p_case_id: id, p_request_id: body.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ case_id: uuid, revision: z.number().int().positive(), facility_id: uuid }).safeParse(result.data);
  return reply.success && reply.data.case_id === id ? NextResponse.json(reply.data, { headers: noStore }) : benefitsFailure();
}
const knowledgeSchema = z.enum(["yes", "no", "unknown"]);
const screeningResultSchema = z.enum(SCREENING_RESULTS);
const screeningReplySchema = z.object({ screening_id: uuid, result: screeningResultSchema, reasons: z.array(z.string()), case_id: uuid.nullable(), recheck_id: uuid.nullable(), recheck_due_on: z.string().nullable() });
const screeningRowSchema = z.object({
  id: uuid, admission_case_id: uuid.nullable(), source: z.enum(["admission", "recheck", "manual"]), coverage: z.enum(SCREENING_COVERAGE), coverage_plan: z.string().nullable(),
  q_property_non_primary: knowledgeSchema, q_income_over_limit: knowledgeSchema, q_life_insurance: knowledgeSchema, q_burial_contract: knowledgeSchema, q_assets: knowledgeSchema, q_power_of_attorney: knowledgeSchema,
  monthly_income_cents: z.number().int().nullable(), assets_cents: z.number().int().nullable(), private_pay_months: z.number().int().nullable(), runway_date: z.string().nullable(),
  answered_by_kind: z.enum(SCREENING_RESPONDENTS).nullable(), answered_at: z.string(), notes: z.string().nullable(), result: screeningResultSchema, reasons: z.array(z.string()),
  created_at: z.string(), recorded_by_name: z.string().nullable(),
  override: z.object({ id: uuid, screening_id: uuid, result: z.enum(["candidate", "not_qualified_now", "needs_answers"]), reason: z.string(), case_id: uuid.nullable(), created_by: uuid, created_by_name: z.string().nullable(), created_at: z.string() }).passthrough().nullable(),
});
const screeningListSchema = z.object({
  resident_id: uuid, facility_id: uuid, permissions: z.object({ can_write: z.boolean(), can_review: z.boolean() }), gate: admissionGateSchema,
  active_case_id: uuid.nullable(), open_recheck: z.object({ id: uuid, due_on: z.string(), status: z.enum(["open", "done", "closed"]), screening_id: uuid }).passthrough().nullable(),
  screenings: z.array(screeningRowSchema),
});
export async function listAdmissionScreenings(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ resident_id: uuid }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Choose a resident.");
  const result = await rpc(auth.actor, "benefits_screening_list", { p_resident_id: query.data.resident_id });
  if (result.error) return rpcFailure(result.error);
  const parsed = screeningListSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.resident_id !== query.data.resident_id) return benefitsFailure();
  return NextResponse.json(parsed.data, { headers: noStore });
}
export async function recordAdmissionScreening(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = recordAdmissionScreeningSchema.safeParse(await readBody(request));
  if (!parsed.success) return benefitsFailure(400, "Answer each question with yes, no or unknown, and enter amounts in dollars and cents.");
  const result = await rpc(auth.actor, "benefits_screening_record", { p_payload: parsed.data.screening, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = screeningReplySchema.safeParse(result.data); if (!reply.success) return benefitsFailure();
  return NextResponse.json(reply.data, { status: 201, headers: noStore });
}
export async function overrideAdmissionScreening(request: Request, screeningId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = overrideAdmissionScreeningSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(screeningId).success || !parsed.success) return benefitsFailure(400, "Choose the result and give the reason.");
  const result = await rpc(auth.actor, "benefits_screening_override", { p_screening_id: screeningId, p_result: parsed.data.result, p_reason: parsed.data.reason, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ override_id: uuid, screening_id: uuid, result: z.enum(["candidate", "not_qualified_now", "needs_answers"]), case_id: uuid.nullable() }).passthrough().safeParse(result.data);
  return reply.success && reply.data.screening_id === screeningId ? NextResponse.json(reply.data, { status: 201, headers: noStore }) : benefitsFailure();
}
const recheckRowSchema = z.object({
  id: uuid, facility_id: uuid, facility_name: z.string(), resident_id: uuid, resident_name: z.string(), due_on: z.string(), overdue: z.boolean(), can_write: z.boolean(),
  last_answered_at: z.string(), last_result: screeningResultSchema, last_reasons: z.array(z.string()),
  q_property_non_primary: knowledgeSchema, q_income_over_limit: knowledgeSchema, q_assets: knowledgeSchema,
});
export async function listBenefitsRechecks(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid.optional(), within_days: z.coerce.number().int().min(0).max(400).default(14) }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Invalid recheck filters.");
  const result = await rpc(auth.actor, "benefits_recheck_list", { p_facility_id: query.data.facility_id ?? null, p_due_within_days: query.data.within_days });
  if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ as_of: z.string(), rechecks: z.array(recheckRowSchema) }).safeParse(result.data);
  if (!parsed.success || (query.data.facility_id && parsed.data.rechecks.some((row) => row.facility_id !== query.data.facility_id))) return benefitsFailure();
  return NextResponse.json(parsed.data, { headers: noStore });
}
export async function completeBenefitsRecheck(request: Request, recheckId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = completeRecheckSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(recheckId).success || !parsed.success) return benefitsFailure(400, "Choose no change or resident left.");
  const result = await rpc(auth.actor, "benefits_recheck_complete", { p_recheck_id: recheckId, p_outcome: parsed.data.outcome, p_note: parsed.data.note ?? null, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ recheck_id: uuid, outcome: z.enum(["no_change", "resident_left"]), next_recheck_id: uuid.nullable(), next_due_on: z.string().nullable() }).safeParse(result.data);
  return reply.success && reply.data.recheck_id === recheckId ? NextResponse.json(reply.data, { headers: noStore }) : benefitsFailure();
}
const sweepFacilitySchema = z.object({
  facility_id: uuid, facility_name: z.string(), started_at: z.string().nullable(), started_by_name: z.string().nullable(), can_write: z.boolean(),
  total: z.number().int().min(0), answered: z.number().int().min(0),
  remaining: z.array(z.object({ resident_id: uuid, resident_name: z.string(), status: z.string() })).nullable(),
});
export async function getBenefitsSweep(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid.optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Invalid facility.");
  const result = await rpc(auth.actor, "benefits_sweep_status", { p_facility_id: query.data.facility_id ?? null });
  if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ can_start: z.boolean(), facilities: z.array(sweepFacilitySchema) }).safeParse(result.data);
  if (!parsed.success || (query.data.facility_id && parsed.data.facilities.some((f) => f.facility_id !== query.data.facility_id))) return benefitsFailure();
  return NextResponse.json(parsed.data, { headers: noStore });
}
export async function startBenefitsSweep(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = startSweepSchema.safeParse(await readBody(request));
  if (!parsed.success) return benefitsFailure(400, "Choose the facility.");
  const result = await rpc(auth.actor, "benefits_sweep_start", { p_facility_id: parsed.data.facility_id, p_note: parsed.data.note ?? null, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ sweep_id: uuid, facility_id: uuid, started_at: z.string(), already_started: z.boolean() }).safeParse(result.data);
  return reply.success && reply.data.facility_id === parsed.data.facility_id ? NextResponse.json(reply.data, { status: 201, headers: noStore }) : benefitsFailure();
}
const promptsSchema = z.object({
  as_of: z.string(),
  late_signal: z.array(z.object({ facility_id: uuid, facility_name: z.string(), live: z.boolean() })),
  runway: z.array(z.object({ resident_id: uuid, resident_name: z.string(), facility_id: uuid, facility_name: z.string(), runway_date: z.string(), days_left: z.number().int(), last_result: screeningResultSchema, can_write: z.boolean() })),
  late_payments: z.array(z.object({ resident_id: uuid, resident_name: z.string(), facility_id: uuid, facility_name: z.string(), oldest_due: z.string(), owed_cents: z.number().int(), can_write: z.boolean() })),
});
export async function getMedicaidPrompts(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid.optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Invalid facility.");
  const result = await rpc(auth.actor, "benefits_prompts", { p_facility_id: query.data.facility_id ?? null });
  if (result.error) return rpcFailure(result.error);
  const parsed = promptsSchema.safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function startPromptCase(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = startPromptCaseSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "Choose the resident.");
  const result = await rpc(auth.actor, "benefits_prompt_start_case", { p_resident_id: parsed.data.resident_id, p_kind: parsed.data.kind, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ case_id: uuid, already_open: z.boolean() }).safeParse(result.data);
  return reply.success ? NextResponse.json(reply.data, { status: 201, headers: noStore }) : benefitsFailure();
}
export async function dismissPrompt(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = dismissPromptSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "Give the number of days and the reason.");
  const result = await rpc(auth.actor, "benefits_prompt_dismiss", { p_resident_id: parsed.data.resident_id, p_kind: parsed.data.kind, p_days: parsed.data.days, p_reason: parsed.data.reason, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ dismissal_id: uuid, until_on: z.string() }).safeParse(result.data);
  return reply.success ? NextResponse.json(reply.data, { status: 201, headers: noStore }) : benefitsFailure();
}
const boardStepEnum = z.enum(BOARD_STEPS);
const boardSchema = z.object({
  as_of: z.string(), facility_id: uuid, facility_name: z.string(), stalled_days: z.number().int(), can_write: z.boolean(),
  steps: z.array(z.object({ step: boardStepEnum, label: z.string() })),
  rows: z.array(z.object({
    case_id: uuid, revision: z.number().int().positive(), status: z.enum(BENEFITS_STATUSES), resident_id: uuid, resident_name: z.string(), next_action: z.string().nullable(), due_date: z.string().nullable(), assignee_name: z.string().nullable(),
    agency_score: z.number().int().min(1).max(5).nullable(), reapply_on: z.string().nullable(), caseworker_id: uuid.nullable(), caseworker_name: z.string().nullable(), caseworker_phone: z.string().nullable(),
    step_dates: z.record(z.string(), z.string()), next_step: boardStepEnum.nullable(), waiting_on: z.enum(["us", "agency"]), days_since_last_step: z.number().int(), stalled: z.boolean(),
    plan_rate_cents: z.number().int().nullable(), revenue_not_collected_cents: z.number().int().nullable(),
    phase: z.enum(["working", "awaiting_first_payment", "renewal"]).optional(), phase_days: z.number().int().nullable().optional(),
    first_payment_on: z.string().nullable().optional(), renewal_date: z.string().nullable().optional(),
  })),
  needs_answers: z.array(z.object({ resident_id: uuid, resident_name: z.string() })), rechecks_due: z.number().int(),
  contacts: z.array(z.object({ id: uuid, name: z.string(), agency: z.enum(CONTACT_AGENCIES), phone: z.string().nullable() })),
});
export async function getMedicaidBoard(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Choose a facility.");
  const result = await rpc(auth.actor, "benefits_board", { p_facility_id: query.data.facility_id });
  if (result.error) return rpcFailure(result.error);
  const parsed = boardSchema.safeParse(result.data);
  return parsed.success && parsed.data.facility_id === query.data.facility_id ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function commandMedicaidBoard(request: Request, caseId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = boardCommandSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(caseId).success || !parsed.success) return benefitsFailure(400, "Review the step and date.");
  const result = await rpc(auth.actor, "benefits_board_command", { p_case_id: caseId, p_action: parsed.data.action, p_payload: parsed.data.payload, p_expected_revision: parsed.data.expected_revision, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data);
  return reply.success && reply.data.case_id === caseId ? NextResponse.json(reply.data, { headers: noStore }) : benefitsFailure();
}
export async function saveBenefitsContact(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = contactSaveSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "A contact needs a name and an agency.");
  const result = await rpc(auth.actor, "benefits_contact_save", { p_payload: parsed.data });
  if (result.error) return rpcFailure(result.error);
  const reply = z.object({ id: uuid, name: z.string() }).passthrough().safeParse(result.data);
  return reply.success ? NextResponse.json(reply.data, { status: 201, headers: noStore }) : benefitsFailure();
}
/** Reading private financial evidence is recorded in the case history before any bytes leave the server. */
export async function recordBenefitsDocumentAccess(actor: CurrentApiActor, caseId: string, documentId: string, kind: "download" | "packet"): Promise<NextResponse | null> {
  const result = await rpc(actor, "benefits_document_access", { p_case_id: caseId, p_document_id: documentId, p_kind: kind });
  return result.error ? rpcFailure(result.error) : null;
}
export async function getBenefitsAccess() {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const result = await rpc(auth.actor, "benefits_access_list"); if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ grants: z.array(z.object({ id: uuid, facility_id: uuid, user_id: uuid, can_write: z.boolean(), can_review: z.boolean(), expires_at: z.string(), revoked_at: z.string().nullable(), reason: z.string(), granted_by: uuid, updated_at: z.string(), user_name: z.string(), facility_name: z.string() })), users: z.array(z.object({ id: uuid, name: z.string() }).passthrough()), can_manage: z.boolean() }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function setBenefitsAccess(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = benefitsAccessSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "Select the staff member, facility, permissions, expiry and reason.");
  const result = await rpc(auth.actor, "benefits_access_set", { p_payload: parsed.data });
  if (result.error) return rpcFailure(result.error);
  return NextResponse.json({ success: true }, { headers: noStore });
}

export const prepareBenefitsDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255), mime_type: z.enum(BENEFITS_MIME_TYPES), size_bytes: z.number().int().positive().max(BENEFITS_MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), document_type: z.string().trim().min(1).max(100), template_version: z.string().max(200).nullable().optional(),
  expected_revision: z.number().int().positive(), request_id: uuid, resume_document_id: uuid.optional(),
}).strict();
const finalizeBodySchema = z.object({ expected_revision: z.number().int().positive(), request_id: uuid }).strict();
const storageObjectSchema = z.object({ id: uuid, version: z.string(), etag: z.string(), size_bytes: z.number(), mime_type: z.string() });
const documentTargetSchema = z.object({ document: benefitsDocumentRowSchema, object: storageObjectSchema.nullable() });
async function documentTarget(actor: CurrentApiActor, caseId: string, documentId: string): Promise<{ target: z.infer<typeof documentTargetSchema> } | { response: NextResponse }> {
  const result = await rpc(actor, "benefits_document_target", { p_case_id: caseId, p_document_id: documentId });
  if (result.error) return { response: rpcFailure(result.error) };
  const parsed = documentTargetSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.document.id !== documentId || parsed.data.document.case_id !== caseId || parsed.data.document.storage_path !== `${actor.organizationId}/${caseId}/${documentId}`) return { response: benefitsFailure() };
  return { target: parsed.data };
}
export async function prepareBenefitsDocument(request: Request, caseId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = prepareBenefitsDocumentSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(caseId).success || !parsed.success) return benefitsFailure(400, "Choose a PDF, JPEG or PNG within the upload size limit.");
  const { request_id, expected_revision, resume_document_id, ...payload } = parsed.data;
  let reply: ReturnType<typeof commandReply.safeParse>;
  if (resume_document_id) {
    // A reservation that lost its browser state: the same original file continues the same document, nothing new is reserved.
    const resumed = await documentTarget(auth.actor, caseId, resume_document_id); if ("response" in resumed) return resumed.response;
    const doc = resumed.target.document;
    if (doc.sha256 !== payload.sha256 || doc.size_bytes !== payload.size_bytes || doc.mime_type !== payload.mime_type || doc.created_by !== auth.actor.id || doc.voided_at) return benefitsFailure(409, "Resume with the same original file you reserved, or upload it as a new document.");
    reply = commandReply.safeParse({ case_id: caseId, revision: expected_revision, document: doc });
  } else {
    const result = await rpc(auth.actor, "benefits_case_command", { p_case_id: caseId, p_action: "prepare_document", p_payload: payload, p_expected_revision: expected_revision, p_request_id: request_id });
    if (result.error) return rpcFailure(result.error);
    reply = commandReply.safeParse(result.data);
  }
  if (!reply.success || !reply.data.document || reply.data.case_id !== caseId) return benefitsFailure();
  const current = await revalidateBenefitsActor(auth.actor); if ("response" in current) return current.response;
  const fresh = await documentTarget(current.actor, caseId, reply.data.document.id); if ("response" in fresh) return fresh.response;
  if (fresh.target.document.status === "ready") return NextResponse.json({ ...reply.data, document: fresh.target.document, upload: null }, { headers: noStore });
  const upload = await current.actor.admin.storage.from(BENEFITS_BUCKET).createSignedUploadUrl(fresh.target.document.storage_path, { upsert: false });
  if (upload.error || !upload.data) return benefitsFailure(503, "Upload reservation was saved. Retry with the same request to get an upload link.");
  const stillAuthorized = await documentTarget(current.actor, caseId, reply.data.document.id); if ("response" in stillAuthorized) return stillAuthorized.response;
  return NextResponse.json({ ...reply.data, upload: upload.data }, { headers: noStore });
}
async function downloadChecked(actor: CurrentApiActor, caseId: string, documentId: string, requireReady: boolean): Promise<{ actor: CurrentApiActor; target: z.infer<typeof documentTargetSchema>; bytes: Uint8Array } | { response: NextResponse }> {
  if (!uuid.safeParse(caseId).success || !uuid.safeParse(documentId).success) return { response: benefitsFailure(400, "Invalid document.") };
  let current = await revalidateBenefitsActor(actor); if ("response" in current) return current;
  const before = await documentTarget(current.actor, caseId, documentId); if ("response" in before) return before;
  if (before.target.document.voided_at) return { response: benefitsFailure(404, "Benefits case or access is unavailable.") };
  if (!before.target.object || (requireReady && before.target.document.status !== "ready")) return { response: benefitsFailure(409, "Document upload is not complete.") };
  const downloaded = await current.actor.admin.storage.from(BENEFITS_BUCKET).download(before.target.document.storage_path);
  if (downloaded.error || !downloaded.data) return { response: benefitsFailure(503, "Document bytes are unavailable. Retry without replacing the document.") };
  if (downloaded.data.size > BENEFITS_MAX_FILE_BYTES) return { response: benefitsFailure(409, "Document size could not be verified.") };
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const doc = before.target.document;
  try {
    const hashes = validateResidentIntakeBytes(bytes, doc.mime_type, doc.size_bytes, doc.sha256);
    const object = before.target.object;
    if (object.size_bytes !== bytes.length || object.mime_type !== doc.mime_type || object.etag.replace(/^"|"$/g, "").toLowerCase() !== hashes.md5) {
      return { response: benefitsFailure(409, "Stored file identity does not match the verified document bytes.") };
    }
  }
  catch { return { response: benefitsFailure(409, "Document bytes do not match the registered file. Upload the correct original again.") }; }
  current = await revalidateBenefitsActor(actor); if ("response" in current) return current;
  const after = await documentTarget(current.actor, caseId, documentId); if ("response" in after) return after;
  if (JSON.stringify(before.target) !== JSON.stringify(after.target)) return { response: benefitsFailure(409, "Document changed during verification. Refresh and retry.") };
  return { actor: current.actor, target: after.target, bytes };
}
export async function getVerifiedBenefitsDocument(actor: CurrentApiActor, caseId: string, documentId: string): Promise<{ bytes: Uint8Array; document: BenefitsDocument } | { response: NextResponse }> {
  const result = await downloadChecked(actor, caseId, documentId, true);
  return "response" in result ? result : { bytes: result.bytes, document: result.target.document };
}
export async function finalizeBenefitsDocument(request: Request, caseId: string, documentId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const body = finalizeBodySchema.safeParse(await readBody(request)); if (!body.success) return benefitsFailure(400, "Invalid upload confirmation.");
  const verified = await downloadChecked(auth.actor, caseId, documentId, false); if ("response" in verified) return verified.response;
  const object = verified.target.object!;
  if (verified.target.document.created_by !== auth.actor.id) return benefitsFailure(404, "Benefits case or access is unavailable.");
  if (verified.target.document.status === "reserved") {
    const attested = await verified.actor.admin.rpc("benefits_document_attest" as never, { p_document_id: documentId, p_sha256: verified.target.document.sha256, p_size_bytes: verified.bytes.length, p_mime_type: verified.target.document.mime_type, p_object_id: object.id, p_object_version: object.version, p_etag: object.etag } as never);
    if (attested.error) return rpcFailure(attested.error);
  }
  const current = await revalidateBenefitsActor(verified.actor); if ("response" in current) return current.response;
  const result = await rpc(current.actor, "benefits_case_command", { p_case_id: caseId, p_action: "finalize_document", p_payload: { document_id: documentId }, p_expected_revision: body.data.expected_revision, p_request_id: body.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success || reply.data.case_id !== caseId) return benefitsFailure();
  return NextResponse.json(reply.data, { headers: noStore });
}
export async function downloadBenefitsDocument(_request: Request, caseId: string, documentId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const verified = await getVerifiedBenefitsDocument(auth.actor, caseId, documentId); if ("response" in verified) return verified.response;
  const recorded = await recordBenefitsDocumentAccess(auth.actor, caseId, documentId, "download"); if (recorded) return recorded;
  const filename = encodeURIComponent(verified.document.filename).replace(/'/g, "%27");
  return new Response(new Blob([Buffer.from(verified.bytes)]).stream(), { headers: { ...noStore, "Content-Type": verified.document.mime_type, "Content-Length": String(verified.bytes.length), "Content-Disposition": `attachment; filename="benefits-document"; filename*=UTF-8''${filename}` } });
}
