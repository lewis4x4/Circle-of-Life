import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cents, decimalAmount, summaryPayloadSchema } from "./payload";
// PostgreSQL seed UUIDs are not necessarily RFC version/variant UUIDs.
export const reviewUuid = z.string().regex(UUID_STRING_RE);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime({ offset: true }).refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
const integer = z.string().regex(/^(0|[1-9]\d*)$/).refine(value => { try {
    return cents(value) >= BigInt(0);
}
catch {
    return false;
} });
const positive = integer.refine(value => BigInt(value) > BigInt(0));
const operation = z.enum(["payment_received", "invoice_posted", "manual_journal_posted", "journal_reversed"]);
const basis = z.enum(["payment_gross", "invoice_gross", "journal_debit_total"]);
const status = z.enum(["prepared", "locally_approved_dispatch_disabled", "invalidated", "rejected", "superseded"]);
const reason = z.string().regex(/^[a-z_]{1,80}$/).nullable();
const disabled = { business_release_eligible: z.literal(false), dispatch_enabled: z.literal(false) };
const classified = { accounting_classification: z.literal("unverified"), ...disabled };
const providerReference = z.string().regex(/^[1-9]\d{0,19}$/);
const mapping = z.strictObject({ companyReference: providerReference, accountReferences: z.array(providerReference).min(1).max(1000), accountingBasis: z.enum(["cash", "accrual"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date() }).refine(value => value.effectiveFrom <= value.effectiveTo);
const line = z.strictObject({ accountReference: providerReference, side: z.enum(["debit", "credit"]), amountCents: positive });
export const sourceControls = z.array(z.strictObject({ amountBasis: basis, operation, eventCount: positive, grossCents: positive })).min(1).max(12);
export const cursorSchema = z.strictObject({ created_at: timestamp, id: reviewUuid });
export type ReviewCursor = z.infer<typeof cursorSchema>;
export type ReviewKind = "events" | "batches" | "rules";
export type ReviewScope = {
    organizationId: string;
    entityId: string;
    facilityId: string | null;
};
export type ReviewRequest = ReviewScope & {
    kind: ReviewKind;
    cursor: ReviewCursor | null;
    limit: number;
};
const identity = { id: reviewUuid, created_at: timestamp };
const event = z.strictObject({ ...identity, facility_id: reviewUuid.nullable(), operation, source_type: z.enum(["payment", "invoice", "journal"]), source_id: reviewUuid, source_version: hash, amount_basis: basis, control_total_cents: positive, claimed: z.boolean(), claimed_batch_id: reviewUuid.nullable() });
const batch = z.strictObject({ ...identity, facility_id: reviewUuid.nullable(), accounting_date: z.iso.date(), status, invalid_reason: reason, source_controls: sourceControls, binding_sha256: hash, ...classified });
const rule = z.strictObject({ ...identity, mapping, content_sha256: hash, policy_reference_sha256: hash, status: z.literal("declared_draft"), is_current: z.boolean(), current_generation: positive.nullable() });
const envelope = { organization_id: reviewUuid, entity_id: reviewUuid, facility_id: reviewUuid.nullable(), observed_at: timestamp, consistency: z.literal("live_page"), total_count: integer, returned_count: z.number().int().min(0).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable(), coverage_scope: z.literal("finance_command_receipts_336_only"), unrepresented_eligible_receipts: integer, staging_stopped: z.boolean(), ...disabled };
const queueSchema = z.discriminatedUnion("kind", [
    z.strictObject({ ...envelope, kind: z.literal("events"), items: z.array(event).max(100) }),
    z.strictObject({ ...envelope, kind: z.literal("batches"), items: z.array(batch).max(100) }),
    z.strictObject({ ...envelope, kind: z.literal("rules"), items: z.array(rule).max(100) }),
]);
export type ReviewPage = z.infer<typeof queueSchema>;
export type SourceControl = z.infer<typeof sourceControls>[number];
function sameId(a: string | null, b: string | null) { return a?.toLowerCase() === b?.toLowerCase(); }
function scoped(actual: {
    organization_id: string;
    entity_id: string;
    facility_id: string | null;
}, expected: ReviewScope) {
    return sameId(actual.organization_id, expected.organizationId) && sameId(actual.entity_id, expected.entityId) && sameId(actual.facility_id, expected.facilityId);
}
// Preserve PostgreSQL microseconds: Date.parse alone would collapse distinct cursors.
function micros(value: string): bigint {
    const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match)
        throw new Error("Invalid review timestamp");
    return BigInt(Date.parse(match[1] + match[3])) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}
function older(a: ReviewCursor, b: ReviewCursor) { return micros(a.created_at) < micros(b.created_at) || (micros(a.created_at) === micros(b.created_at) && a.id.toLowerCase() < b.id.toLowerCase()); }
export function parseReviewPage(value: unknown, request: ReviewRequest): ReviewPage {
    reviewUuid.parse(request.organizationId);
    reviewUuid.parse(request.entityId);
    reviewUuid.nullable().parse(request.facilityId);
    z.number().int().min(1).max(100).parse(request.limit);
    cursorSchema.nullable().parse(request.cursor);
    const page = queueSchema.parse(value);
    if (!scoped(page, request) || page.kind !== request.kind)
        throw new Error("Review response scope mismatch");
    if (page.returned_count !== page.items.length || page.items.length > request.limit || BigInt(page.total_count) < BigInt(page.items.length) || page.has_more !== (page.next_cursor !== null) || (page.has_more && (page.items.length !== request.limit || BigInt(page.total_count) <= BigInt(page.items.length))))
        throw new Error("Invalid review page cardinality");
    const ids = new Set<string>();
    let previous = request.cursor;
    for (const item of page.items) {
        if (ids.has(item.id.toLowerCase()) || (previous && !older(item, previous)))
            throw new Error("Invalid review page ordering");
        ids.add(item.id.toLowerCase());
        previous = item;
        if ("facility_id" in item && request.facilityId !== null && !sameId(item.facility_id, request.facilityId))
            throw new Error("Review item scope mismatch");
        if ("status" in item && "invalid_reason" in item && ["prepared", "locally_approved_dispatch_disabled"].includes(item.status) && item.invalid_reason !== null)
            throw new Error("Active review has a current invalidation reason");
        if ("claimed" in item && !item.claimed && item.claimed_batch_id !== null)
            throw new Error("Invalid source claim");
    }
    if (request.cursor === null && !page.has_more && BigInt(page.total_count) !== BigInt(page.items.length))
        throw new Error("Incomplete first review page");
    const last = page.items.at(-1);
    if (page.next_cursor && (!last || page.next_cursor.created_at !== last.created_at || !sameId(page.next_cursor.id, last.id)))
        throw new Error("Invalid next cursor");
    return page;
}
// Strip unneeded columns, especially historical session identifiers, before UI state.
const detailSchema = z.object({
    batch: z.object({ ...identity, organization_id: reviewUuid, entity_id: reviewUuid, facility_id: reviewUuid.nullable(), accounting_date: z.iso.date(), currency: z.literal("USD"), status, rules_version_id: reviewUuid, payload: summaryPayloadSchema, payload_sha256: hash, member_set_sha256: hash, source_controls: sourceControls, source_controls_sha256: hash, binding_sha256: hash, supersedes: reviewUuid.nullable(), ...classified }),
    members: z.array(z.strictObject({ eventId: reviewUuid, identitySha256: hash, sourceVersion: hash, amountBasis: basis, operation, controlTotalCents: positive, economicDate: z.iso.date(), lines: z.array(line).min(2).max(1000) })).min(1).max(1000),
    decision_history: z.array(z.object({ ...identity, batch_id: reviewUuid, action: z.enum(["prepare", "approve", "reject", "invalidate", "supersede"]), origin: z.enum(["operator", "control", "rules", "scope", "period"]), binding_sha256: hash, resulting_status: status, reason_code: reason })),
    invalid_reason: reason, ...classified, binding_claim: z.literal("declared_local_only"),
});
export type ReviewDetail = z.infer<typeof detailSchema>;
export function parseReviewDetail(value: unknown, scope: ReviewScope, batchId: string): ReviewDetail {
    const detail = detailSchema.parse(value);
    if (["prepared", "locally_approved_dispatch_disabled"].includes(detail.batch.status) && detail.invalid_reason !== null)
        throw new Error("Active batch has a current invalidation reason");
    // An entity-wide queue can open a narrower batch; facility queues cannot broaden.
    if (!scoped({ ...detail.batch, facility_id: scope.facilityId === null ? null : detail.batch.facility_id }, scope) || !sameId(detail.batch.id, batchId) || !sameId(detail.batch.payload.batchReference, batchId) || detail.batch.payload.accountingDate !== detail.batch.accounting_date || detail.decision_history.some(row => !sameId(row.batch_id, batchId) || row.binding_sha256 !== detail.batch.binding_sha256))
        throw new Error("Batch detail scope mismatch");
    if (new Set(detail.members.map(row => row.eventId.toLowerCase())).size !== detail.members.length)
        throw new Error("Duplicate batch member");
    return detail;
}
function readError(code: string | undefined): Error {
    return new Error(code === "42501" || code === "PGRST301" || code === "PGRST302" || code === "PGRST303" ? "Access unavailable. Refresh your session and scope before retrying." : "Accounting review could not be loaded. Retry to check the current state.");
}
export async function loadReviewPage(client: SupabaseClient<Database>, request: ReviewRequest, signal: AbortSignal): Promise<ReviewPage> {
    const { data, error } = await client.rpc("finance_review_queue", { p_entity: request.entityId, p_facility: request.facilityId, p_kind: request.kind, p_after_created_at: request.cursor?.created_at ?? null, p_after_id: request.cursor?.id ?? null, p_limit: request.limit }).abortSignal(signal);
    if (error)
        throw readError(error.code);
    return parseReviewPage(data, request);
}
export async function loadReviewDetail(client: SupabaseClient<Database>, scope: ReviewScope, batchId: string, signal: AbortSignal): Promise<ReviewDetail> {
    const { data, error } = await client.rpc("finance_batch_snapshot", { p_batch: batchId }).abortSignal(signal);
    if (error)
        throw readError(error.code);
    return parseReviewDetail(data, scope, batchId);
}
const easternTimestamp = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
export function formatReviewTimestamp(value: string): string {
    timestamp.parse(value);
    return `${easternTimestamp.format(new Date(value))} ET`;
}
export function formatReviewCents(value: string): string {
    const [whole, fraction] = decimalAmount(value).split(".");
    return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
const entityChoice = z.object({ id: reviewUuid, name: z.string().min(1), organization_id: reviewUuid });
const facilityChoice = entityChoice.extend({ entity_id: reviewUuid });
export type ReviewChoices = {
    entities: z.infer<typeof entityChoice>[];
    facilities: z.infer<typeof facilityChoice>[];
};
export async function loadReviewChoices(client: SupabaseClient<Database>, organizationId: string, signal: AbortSignal): Promise<ReviewChoices> {
    reviewUuid.parse(organizationId);
    const entities: ReviewChoices["entities"] = [];
    const facilities: ReviewChoices["facilities"] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    function validateRows(rows: { id: string; organization_id: string }[]) {
        for (const row of rows) {
            const normalized = row.id.toLowerCase();
            if (!sameId(row.organization_id, organizationId) || seen.has(normalized) || (after !== null && normalized <= after.toLowerCase()))
                throw new Error("Selector scope or cursor mismatch");
            seen.add(normalized); after = row.id;
        }
    }
    // Continue until an empty page: the server row cap can be lower than our
    // requested limit. Keysets avoid skips caused by deletions before an offset.
    for (;;) {
        signal.throwIfAborted();
        let query = client.from("entities").select("id,name,organization_id").eq("organization_id", organizationId).is("deleted_at", null).order("id").limit(200);
        if (after !== null) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(signal);
        if (error) throw readError(error.code);
        const rows = z.array(entityChoice).max(200).parse(data);
        validateRows(rows); entities.push(...rows);
        if (rows.length === 0) break;
    }
    const entityIds = new Set(entities.map(row => row.id.toLowerCase()));
    seen.clear(); after = null;
    for (;;) {
        signal.throwIfAborted();
        let query = client.from("facilities").select("id,name,organization_id,entity_id").eq("organization_id", organizationId).is("deleted_at", null).order("id").limit(200);
        if (after !== null) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(signal);
        if (error) throw readError(error.code);
        const rows = z.array(facilityChoice).max(200).parse(data);
        validateRows(rows);
        if (rows.some(row => !entityIds.has(row.entity_id.toLowerCase()))) throw new Error("Facility entity unavailable in authorized selectors");
        facilities.push(...rows);
        if (rows.length === 0) break;
    }
    return { entities, facilities };
}
