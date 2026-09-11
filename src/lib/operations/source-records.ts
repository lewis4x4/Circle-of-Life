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

export const OBSERVATION_KINDS = ["generator_test", "carbon_monoxide_check", "extinguisher_check"] as const;
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
