import { z } from "zod";

import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { isSourceDeliveryOutcome, presentSourceOutcome, type SourceDeliveryOutcome } from "@/lib/operations/source-links";

/**
 * COL-154 drill and asset observation records. A drill log becomes final only
 * when a person finalizes it; an asset observation is recorded final by a
 * staff member who observed the work. Each command commits one version and
 * delivers it through the COL-147 mechanism in the same transaction. These
 * helpers only shape requests and read replies; the database owns finality,
 * the late/on-behalf/future rules, the refusal of self-tests and photos, the
 * request ledger, the allowlist and every delivery outcome.
 */

/** Any operations role may record, finalize, correct or void at a site it holds; the recorder list decides satisfaction in the database. */
export const SOURCE_RECORD_ROLES = OPERATIONS_VIEW_ROLES;

/** COL-159 adds the two AED components: operation and equipment currency are separate records against an `aed` asset. */
export const OBSERVATION_KINDS = ["generator_test", "carbon_monoxide_check", "extinguisher_check", "aed_operation_check", "aed_equipment_check"] as const;
/** Only `staff_observed` is accepted; the other two are named so the database can refuse them by name rather than as a generic shape error. */
export const OBSERVATION_BASES = ["staff_observed", "automatic_self_test", "photo_only"] as const;
export const OBSERVATION_OUTCOMES = ["pass", "fail"] as const;
export const DRILL_TYPES = ["fire", "elopement", "tornado"] as const;
export const DRILL_OUTCOMES = ["performed", "failed"] as const;
export const ASSET_OBSERVATION_ACTIONS = ["correct", "void"] as const;
export const DRILL_LOG_ACTIONS = ["finalize", "correct", "void"] as const;

const uuid = z.string().uuid();
/** The database appends `:deliver` for the delivery key, so a record request key is 8 to 120 characters. */
export const sourceRecordRequestKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/, "request_key must be 8 to 120 key characters");
const text = (max: number) => z.string().trim().min(1).max(max);
const isoInstant = z.string().datetime({ offset: true });
/** Typed readings keyed as the governing rule's inputs; the rule decides definition, requirement and range at delivery. */
export const readingsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "readings must be keyed by input names"), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((readings) => Object.keys(readings).length <= 50, { message: "readings must be at most fifty values" });

const observationCore = {
  observed_at: isoInstant,
  observed_by: uuid.optional(),
  outcome: z.enum(OBSERVATION_OUTCOMES),
  readings: readingsSchema.optional(),
  issue_summary: text(2000).optional(),
  note: text(4000).optional(),
  entry_reason: text(2000).optional(),
};

export const recordAssetObservationBodySchema = z
  .object({
    request_key: sourceRecordRequestKeySchema,
    payload: z
      .object({ facility_id: uuid, asset_id: uuid, observation_kind: z.enum(OBSERVATION_KINDS), basis: z.enum(OBSERVATION_BASES), ...observationCore })
      .strict(),
  })
  .strict();

const correctObservationPayload = z
  .object({
    reason: text(2000),
    asset_id: uuid.optional(),
    observed_at: isoInstant.optional(),
    observed_by: uuid.optional(),
    outcome: z.enum(OBSERVATION_OUTCOMES).optional(),
    readings: readingsSchema.optional(),
    issue_summary: text(2000).nullable().optional(),
    note: text(4000).nullable().optional(),
    entry_reason: text(2000).nullable().optional(),
  })
  .strict();
const voidPayload = z.object({ reason: text(2000) }).strict();
const expectedVersion = z.number().int().min(1);

export const assetObservationCommandBodySchema = z.discriminatedUnion("action", [
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("correct"), expected_version: expectedVersion, payload: correctObservationPayload }).strict(),
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("void"), payload: voidPayload }).strict(),
]);

const correctDrillPayload = z
  .object({
    reason: text(2000),
    drill_type: z.enum(DRILL_TYPES).optional(),
    drill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "drill_date must be a calendar date").optional(),
    drill_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "drill_time must be a time of day").optional(),
    pull_station_activated: z.boolean().optional(),
    staff_present_count: z.number().int().min(0).nullable().optional(),
    residents_present_count: z.number().int().min(0).nullable().optional(),
    conducted_by: uuid.nullable().optional(),
    notes: text(4000).nullable().optional(),
    readings: readingsSchema.optional(),
    outcome: z.enum(DRILL_OUTCOMES).optional(),
    issue_summary: text(2000).nullable().optional(),
    entry_reason: text(2000).nullable().optional(),
  })
  .strict();

export const drillLogCommandBodySchema = z.discriminatedUnion("action", [
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("finalize"), payload: z.object({ entry_reason: text(2000).optional() }).strict() }).strict(),
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("correct"), expected_version: expectedVersion, payload: correctDrillPayload }).strict(),
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("void"), payload: voidPayload }).strict(),
]);

export const listAssetObservationsQuerySchema = z
  .object({
    facility_id: uuid,
    asset_id: uuid.optional(),
    kind: z.enum(OBSERVATION_KINDS).optional(),
    voided: z.enum(["true", "false"]).optional(),
  })
  .strict();

/**
 * COL-159 facility service records: one inspection, cleaning or maintenance
 * action on one occasion against the site (facility kinds) or a named asset
 * (asset kinds), by a staff member or a site-linked vendor. The database
 * decides the adapter by kind, refuses the wrong subject, performer, asset
 * type, certificate or instant by name, and never writes an asset, a
 * profile date, a document or a ticket from a service record.
 */
export const FACILITY_SERVICE_KINDS = ["fire_safety_inspection", "fire_inspection", "sprinkler_inspection"] as const;
export const ASSET_SERVICE_KINDS = ["extinguisher_inspection", "hood_cleaning", "ac_filter_change"] as const;
export const SERVICE_KINDS = [...FACILITY_SERVICE_KINDS, ...ASSET_SERVICE_KINDS] as const;
export const SERVICE_PERFORMER_KINDS = ["staff", "vendor"] as const;
export const SERVICE_OUTCOMES = ["pass", "fail"] as const;
export const SERVICE_RECORD_ACTIONS = ["correct", "void"] as const;
/** COL-159 dietary records: meal-level substitution, dietitian menu approval and the emergency food supply check; no resident is ever referenced. */
export const DIETARY_RECORD_KINDS = ["meal_substitution", "menu_approval", "emergency_food_supply_check"] as const;
export const MEAL_PERIODS = ["breakfast", "lunch", "dinner", "snack_am", "snack_pm", "snack_hs"] as const;
export const DIETARY_OUTCOMES = ["performed", "failed"] as const;
export const DIETARY_RECORD_ACTIONS = ["correct", "void"] as const;

type ServiceKind = (typeof SERVICE_KINDS)[number];
export function isAssetServiceKind(kind: ServiceKind): boolean {
  return (ASSET_SERVICE_KINDS as readonly string[]).includes(kind);
}

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a calendar date");

const serviceCore = {
  performed_at: isoInstant,
  performer_kind: z.enum(SERVICE_PERFORMER_KINDS).optional(),
  performed_by: uuid.optional(),
  vendor_id: uuid.optional(),
  performer_label: text(200).optional(),
  outcome: z.enum(SERVICE_OUTCOMES),
  readings: readingsSchema.optional(),
  issue_summary: text(2000).optional(),
  next_due_on: calendarDate.optional(),
  certificate_document_id: uuid.optional(),
  note: text(4000).optional(),
  entry_reason: text(2000).optional(),
};

type ServicePerformerShape = { performer_kind?: "staff" | "vendor"; performed_by?: string; vendor_id?: string; performer_label?: string };

/** The composite shapes the database refuses by name, refused here first so the operator is answered before the round trip. */
function refineServicePerformer(payload: ServicePerformerShape, ctx: z.RefinementCtx) {
  const kind = payload.performer_kind ?? "staff";
  if (kind === "vendor") {
    if (!payload.vendor_id) ctx.addIssue({ code: "custom", message: "vendor_id must be set for a vendor performer" });
    if (payload.performed_by) ctx.addIssue({ code: "custom", message: "performed_by must be empty for a vendor performer" });
  } else if (payload.vendor_id || payload.performer_label) {
    ctx.addIssue({ code: "custom", message: "vendor_id and performer_label must be empty for a staff performer" });
  }
}

export const recordFacilityServiceBodySchema = z
  .object({
    request_key: sourceRecordRequestKeySchema,
    payload: z
      .object({ facility_id: uuid, service_kind: z.enum(SERVICE_KINDS), asset_id: uuid.optional(), ...serviceCore })
      .strict()
      .superRefine((payload, ctx) => {
        if (isAssetServiceKind(payload.service_kind) && !payload.asset_id) ctx.addIssue({ code: "custom", message: `${payload.service_kind} is recorded against a named asset` });
        if (!isAssetServiceKind(payload.service_kind) && payload.asset_id) ctx.addIssue({ code: "custom", message: `${payload.service_kind} is recorded against the site, not an asset` });
        refineServicePerformer(payload, ctx);
      }),
  })
  .strict();

const correctServicePayload = z
  .object({
    reason: text(2000),
    asset_id: uuid.optional(),
    performed_at: isoInstant.optional(),
    performer_kind: z.enum(SERVICE_PERFORMER_KINDS).optional(),
    performed_by: uuid.nullable().optional(),
    vendor_id: uuid.nullable().optional(),
    performer_label: text(200).nullable().optional(),
    outcome: z.enum(SERVICE_OUTCOMES).optional(),
    readings: readingsSchema.optional(),
    issue_summary: text(2000).nullable().optional(),
    next_due_on: calendarDate.nullable().optional(),
    certificate_document_id: uuid.nullable().optional(),
    note: text(4000).nullable().optional(),
    entry_reason: text(2000).nullable().optional(),
  })
  .strict();

export const facilityServiceCommandBodySchema = z.discriminatedUnion("action", [
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("correct"), expected_version: expectedVersion, payload: correctServicePayload }).strict(),
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("void"), payload: voidPayload }).strict(),
]);

export const listFacilityServicesQuerySchema = z
  .object({
    facility_id: uuid,
    kind: z.enum(SERVICE_KINDS).optional(),
    asset_id: uuid.optional(),
    voided: z.enum(["true", "false"]).optional(),
  })
  .strict();

const dietaryCore = {
  performed_at: isoInstant,
  performed_by: uuid.optional(),
  outcome: z.enum(DIETARY_OUTCOMES).optional(),
  service_date: calendarDate.optional(),
  meal_period: z.enum(MEAL_PERIODS).optional(),
  planned_item: text(200).optional(),
  substitute_item: text(200).optional(),
  substitution_reason: text(2000).optional(),
  meal_service_id: uuid.optional(),
  menu_label: text(200).optional(),
  approver_label: text(200).optional(),
  approval_document_id: uuid.optional(),
  readings: readingsSchema.optional(),
  issue_summary: text(2000).optional(),
  note: text(4000).optional(),
  entry_reason: text(2000).optional(),
};

type DietaryShape = z.infer<z.ZodObject<typeof dietaryCore>> & { record_kind: (typeof DIETARY_RECORD_KINDS)[number] };

/** Kind-specific shapes, refused here first; the database refuses again by name. */
function refineDietaryRecord(payload: DietaryShape, ctx: z.RefinementCtx) {
  const mealFields = [payload.service_date, payload.meal_period, payload.planned_item, payload.substitute_item, payload.substitution_reason];
  const menuFields = [payload.menu_label, payload.approver_label];
  if (payload.record_kind === "meal_substitution") {
    if (mealFields.some((value) => value === undefined)) ctx.addIssue({ code: "custom", message: "service_date, meal_period, planned_item, substitute_item and substitution_reason are required for a meal substitution" });
    if (menuFields.some((value) => value !== undefined) || payload.approval_document_id) ctx.addIssue({ code: "custom", message: "menu_label, approver_label and approval_document_id must be empty for a meal substitution" });
    if (payload.outcome === "failed") ctx.addIssue({ code: "custom", message: "A meal substitution is recorded as performed; state a problem as an issue summary" });
  } else if (payload.record_kind === "menu_approval") {
    if (menuFields.some((value) => value === undefined)) ctx.addIssue({ code: "custom", message: "menu_label and approver_label are required for a menu approval" });
    if (mealFields.some((value) => value !== undefined) || payload.meal_service_id) ctx.addIssue({ code: "custom", message: "meal fields must be empty for a menu approval" });
    if (payload.outcome === "failed") ctx.addIssue({ code: "custom", message: "A menu approval is recorded as performed; state a problem as an issue summary" });
  } else if (mealFields.some((value) => value !== undefined) || payload.meal_service_id || menuFields.some((value) => value !== undefined) || payload.approval_document_id) {
    ctx.addIssue({ code: "custom", message: "meal and menu fields must be empty for an emergency food supply check" });
  }
  if (payload.outcome === "failed" && !payload.issue_summary) ctx.addIssue({ code: "custom", message: "A failed outcome requires an issue summary" });
}

export const recordDietaryRecordBodySchema = z
  .object({
    request_key: sourceRecordRequestKeySchema,
    payload: z
      .object({ facility_id: uuid, record_kind: z.enum(DIETARY_RECORD_KINDS), ...dietaryCore })
      .strict()
      .superRefine(refineDietaryRecord),
  })
  .strict();

const correctDietaryPayload = z
  .object({
    reason: text(2000),
    performed_at: isoInstant.optional(),
    performed_by: uuid.optional(),
    outcome: z.enum(DIETARY_OUTCOMES).optional(),
    service_date: calendarDate.nullable().optional(),
    meal_period: z.enum(MEAL_PERIODS).nullable().optional(),
    planned_item: text(200).nullable().optional(),
    substitute_item: text(200).nullable().optional(),
    substitution_reason: text(2000).nullable().optional(),
    meal_service_id: uuid.nullable().optional(),
    menu_label: text(200).nullable().optional(),
    approver_label: text(200).nullable().optional(),
    approval_document_id: uuid.nullable().optional(),
    readings: readingsSchema.optional(),
    issue_summary: text(2000).nullable().optional(),
    note: text(4000).nullable().optional(),
    entry_reason: text(2000).nullable().optional(),
  })
  .strict();

export const dietaryRecordCommandBodySchema = z.discriminatedUnion("action", [
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("correct"), expected_version: expectedVersion, payload: correctDietaryPayload }).strict(),
  z.object({ request_key: sourceRecordRequestKeySchema, action: z.literal("void"), payload: voidPayload }).strict(),
]);

export const listDietaryRecordsQuerySchema = z
  .object({
    facility_id: uuid,
    kind: z.enum(DIETARY_RECORD_KINDS).optional(),
    voided: z.enum(["true", "false"]).optional(),
  })
  .strict();

export type RecordFacilityServiceBody = z.infer<typeof recordFacilityServiceBodySchema>;
export type FacilityServiceCommandBody = z.infer<typeof facilityServiceCommandBodySchema>;
export type ListFacilityServicesQuery = z.infer<typeof listFacilityServicesQuerySchema>;
export type RecordDietaryRecordBody = z.infer<typeof recordDietaryRecordBodySchema>;
export type DietaryRecordCommandBody = z.infer<typeof dietaryRecordCommandBodySchema>;
export type ListDietaryRecordsQuery = z.infer<typeof listDietaryRecordsQuerySchema>;

/** Service record columns read through the session (site access governs the row); the certificate is an id under the vault's own access. */
export const FACILITY_SERVICE_SELECT =
  "id, organization_id, facility_id, service_kind, asset_id, performed_at, performer_kind, performed_by, vendor_id, performer_label, outcome, readings, issue_summary, next_due_on, certificate_document_id, note, entry_reason, correction_reason, record_version, finalized_at, finalized_by, version_recorded_at, version_recorded_by, voided_at, voided_by, void_reason, created_at, updated_at";
/** Dietary record columns read through the session; no resident column exists. */
export const DIETARY_RECORD_SELECT =
  "id, organization_id, facility_id, record_kind, performed_at, performed_by, outcome, service_date, meal_period, planned_item, substitute_item, substitution_reason, meal_service_id, menu_label, approver_label, approval_document_id, readings, issue_summary, note, entry_reason, correction_reason, record_version, finalized_at, finalized_by, version_recorded_at, version_recorded_by, voided_at, voided_by, void_reason, created_at, updated_at";

export type RecordAssetObservationBody = z.infer<typeof recordAssetObservationBodySchema>;
export type AssetObservationCommandBody = z.infer<typeof assetObservationCommandBodySchema>;
export type DrillLogCommandBody = z.infer<typeof drillLogCommandBodySchema>;
export type ListAssetObservationsQuery = z.infer<typeof listAssetObservationsQuerySchema>;

/** Observation columns read through the session (site access governs the row). */
export const ASSET_OBSERVATION_SELECT =
  "id, organization_id, facility_id, asset_id, observation_kind, basis, observed_at, observed_by, outcome, readings, issue_summary, note, entry_reason, correction_reason, record_version, finalized_at, finalized_by, version_recorded_at, version_recorded_by, voided_at, voided_by, void_reason, created_at, updated_at";

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export type SourceRecordOutcome = {
  record: Record<string, unknown> & { id: string };
  delivery: SourceDeliveryOutcome | null;
  linked: boolean;
  replayed: boolean;
  link_reason?: string;
};

/** Every command returns the record after the command, the delivery it made (or null when nothing could be delivered), whether it linked, and whether this was a replay. */
export function isSourceRecordOutcome(value: unknown): value is SourceRecordOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { record?: unknown; delivery?: unknown; linked?: unknown; replayed?: unknown; link_reason?: unknown };
  return (
    hasId(candidate.record) &&
    (candidate.delivery === null || candidate.delivery === undefined || isSourceDeliveryOutcome(candidate.delivery)) &&
    typeof candidate.linked === "boolean" &&
    typeof candidate.replayed === "boolean" &&
    (candidate.link_reason === undefined || typeof candidate.link_reason === "string")
  );
}

/** A command reply as the route returns it: the record, the delivery without idempotency material, and the link verdict. */
export function presentSourceRecordOutcome(outcome: SourceRecordOutcome) {
  let delivery: Omit<ReturnType<typeof presentSourceOutcome>, "outcome"> | null = null;
  if (outcome.delivery) {
    const { outcome: _class, ...rest } = presentSourceOutcome(outcome.delivery);
    void _class;
    delivery = rest;
  }
  return {
    outcome: "record" as const,
    record: outcome.record,
    delivery,
    linked: outcome.linked,
    replayed: outcome.replayed,
    ...(outcome.link_reason ? { link_reason: outcome.link_reason } : {}),
  };
}

/** The current record version a stale correction names, so the client can re-read and retry against it. */
const RECORD_VERSION_IN_DETAILS = /current_record_version=([0-9]{1,9})/i;

export function currentRecordVersion(error: { details?: string | null; message?: string } | null | undefined): number | undefined {
  if (!error) return undefined;
  const match = RECORD_VERSION_IN_DETAILS.exec(`${error.details ?? ""} ${error.message ?? ""}`)?.[1];
  return match ? Number(match) : undefined;
}
