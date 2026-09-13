import { z } from "zod";
import { databaseUuidSchema as uuid } from "./database-uuid";

export const corporateDeliverableKeys = [
  "hfo-al-m09-01",
  "hfo-al-m09-02",
  "hfo-al-m09-03",
  "hfo-al-q01-01",
  "hfo-al-c08-01",
] as const;
export const corporateDeliverableKeySchema = z.enum(corporateDeliverableKeys);
const requestKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const evidence = z.string().trim().min(1).max(1000);
const exactlyOneOrNeither = (a: unknown, b: unknown) => !(a != null && b != null);
const actualDate = <T extends z.ZodRawShape>(shape: T, at: keyof T & string, on: keyof T & string) =>
  z.object(shape).strict().refine(value => {
    const fields = value as Record<string, unknown>;
    return Number(fields[at] != null) + Number(fields[on] != null) === 1;
  }, "Retain the actual date precision");

const base = { task_id: uuid, request_key: requestKey };
const expected = { expectation_id: uuid, expected_revision: uuid };
export const corporateDeliverableCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("register"), period_start: date, period_end: date, period_provenance: evidence, expected_facility_ids: z.array(uuid).min(1).max(100) }).strict()
    .refine(value => value.period_end >= value.period_start && new Set(value.expected_facility_ids).size === value.expected_facility_ids.length, "Use one bounded period and unique expected sites"),
  z.object({ ...base, ...expected, action: z.literal("configure"), recipient_label: z.string().trim().min(1).max(200).nullable(), backup_label: z.string().trim().min(1).max(200).nullable(), due_on: date.nullable(), configuration_provenance: evidence, due_provenance: evidence.nullable() }).strict()
    .refine(value => (value.due_on == null) === (value.due_provenance == null), "A due date needs attributable provenance"),
  z.object({ ...base, ...expected, action: z.literal("prepare"), source_family: z.enum(["census", "trust", "stand_up", "resident_document"]), stand_up_week_start: date.optional(), native_version_id: uuid.optional() }).strict()
    .refine(value => value.source_family === "stand_up" ? !!value.stand_up_week_start && !value.native_version_id : value.source_family === "resident_document" ? !!value.native_version_id && !value.stand_up_week_start : !value.stand_up_week_start && !value.native_version_id, "Provide only the selected native source identity"),
  actualDate({ ...base, ...expected, action: z.literal("sent"), version_id: uuid, channel: evidence, source_evidence: evidence, sent_at: timestamp.optional(), sent_on: date.optional() }, "sent_at", "sent_on"),
  actualDate({ ...base, ...expected, action: z.literal("received"), version_id: uuid, channel: evidence, source_evidence: evidence, received_at: timestamp.optional(), received_on: date.optional() }, "received_at", "received_on"),
  actualDate({ ...base, ...expected, action: z.literal("accepted"), version_id: uuid, approver_label: z.string().trim().min(1).max(200), source_evidence: evidence, accepted_at: timestamp.optional(), accepted_on: date.optional() }, "accepted_at", "accepted_on"),
  actualDate({ ...base, ...expected, action: z.literal("rejected"), version_id: uuid, reason: evidence, issue_id: uuid, channel: evidence, source_evidence: evidence, rejected_at: timestamp.optional(), rejected_on: date.optional() }, "rejected_at", "rejected_on"),
  z.object({ ...base, ...expected, action: z.literal("link_follow_up"), problem_state: z.enum(["missing", "late", "rejected"]), issue_id: uuid }).strict(),
  z.object({ ...base, action: z.literal("capture_meeting"), period_start: date, period_end: date, coverage_revision: uuid, presented_at: timestamp.nullable().optional(), presented_on: date.nullable().optional(), presentation_provenance: evidence.nullable().optional() }).strict()
    .refine(value => exactlyOneOrNeither(value.presented_at, value.presented_on) && ((value.presented_at != null || value.presented_on != null) === (value.presentation_provenance != null)), "Presentation evidence and its actual date must stay together"),
]);

const event = z.object({ id: uuid, sequence: z.number().int().positive(), kind: z.enum(["configured", "prepared", "sent", "received", "accepted", "rejected", "follow_up_linked"]), version_id: uuid.nullable(), actor_id: uuid, recorded_at: z.string(), details: z.record(z.string(), z.unknown()) }).strict();
const version = z.object({ id: uuid, version: z.number().int().positive(), task_id: uuid, source_family: z.enum(["census", "trust", "stand_up", "resident_document"]), source_version: z.string(), prepared_at: z.string(), captured: z.record(z.string(), z.unknown()).nullable() }).strict();
const issue = z.object({ id: uuid, status: z.string(), owner_user_id: uuid.nullable(), owner_role: z.string().nullable(), backup_user_id: uuid.nullable(), backup_role: z.string().nullable(), owner_current: z.boolean().nullable(), backup_current: z.boolean().nullable(), follow_up_at: z.string().nullable(), next_action: z.string() }).strict();
const expectation = z.object({
  id: uuid, revision: uuid, facility_id: uuid, component_key: corporateDeliverableKeySchema, subject_kind: z.enum(["facility", "resident", "unconfirmed"]), resident_id: uuid.nullable(), payload_included:z.boolean(),
  period_start: date, period_end: date, period_provenance: z.string(), mapping_state: z.enum(["mapped", "unconfirmed"]), recipient_label: z.string().nullable(), backup_label: z.string().nullable(), due_on: date.nullable(), due_state: z.enum(["unknown", "documented"]),
  current_state: z.enum(["expected", "prepared", "sent", "received", "accepted", "rejected"]), current_version_id: uuid.nullable(), versions: z.array(version).max(1), events: z.array(event).max(50), history_complete: z.boolean(), history_cursor: z.object({before_version:z.number().int().nonnegative(),before_sequence:z.number().int().nonnegative()}).strict().nullable(), follow_up: issue.nullable(),
}).strict();
const coverage = z.object({ id: uuid, revision: uuid, version: z.number().int().positive(), facility_ids: z.array(uuid).min(1).max(100), recorded_at: z.string(), provenance: z.string() }).strict();
const site = z.object({ facility_id: uuid, status: z.enum(["expected", "missing", "unavailable"]), expectation: expectation.nullable() }).strict();
const meetingExpectation=z.object({id:uuid,component_key:corporateDeliverableKeySchema,subject_kind:z.enum(["facility","resident","unconfirmed"]),resident_id:uuid.nullable(),current_state:z.enum(["expected","prepared","sent","received","accepted","rejected"]),current_version_id:uuid.nullable(),current_version:version.extend({captured:z.record(z.string(),z.unknown())}).nullable(),recipient_label:z.string().nullable(),backup_label:z.string().nullable(),due_on:date.nullable(),follow_up:issue.nullable()}).strict();
const meetingSnapshot=z.object({schema_version:z.literal(1),activity_key:corporateDeliverableKeySchema,component_label:z.string(),period_start:date,period_end:date,coverage,sites:z.array(z.object({facility_id:uuid,facility_label:z.string(),status:z.enum(["expected","missing","unavailable"]),expectation:meetingExpectation.nullable()}).strict()).max(100),front_office_boundary:z.literal("standup_weekly_allowlist_only")}).strict();
const meeting = z.object({ id: uuid, coverage_revision: uuid, captured_at: z.string(), presented_at: z.string().nullable(), presented_on: date.nullable(), presentation_provenance: z.string().nullable(), snapshot: meetingSnapshot }).strict();

export const corporateDeliverablesReplySchema = z.object({
  task_id: uuid, activity_key: corporateDeliverableKeySchema, component_label: z.string(), can_manage: z.boolean(), availability: z.enum(["available", "unavailable"]), reason: z.string(), period_start: date, period_end: date,
  available_sites: z.array(z.object({ id: uuid, label: z.string() }).strict()).max(100), issue_candidates: z.array(z.object({ id: uuid, label: z.string(), status: z.string(), owner_label: z.string().nullable(), owner_current: z.boolean() }).strict()).max(100),
  coverage: coverage.nullable(), coverage_complete: z.boolean(), sites: z.array(site).max(100), meetings: z.array(meeting).max(100), meetings_complete: z.boolean(), complete: z.boolean(), front_office_boundary: z.literal("standup_weekly_allowlist_only"),
}).strict().superRefine((value,ctx)=>{
  const expected=value.coverage?.facility_ids??[];if(new Set(expected).size!==expected.length)ctx.addIssue({code:"custom",message:"Duplicate expected site"});
  if(!value.coverage&&value.coverage_complete)ctx.addIssue({code:"custom",message:"Missing coverage cannot be complete"});
  if(value.coverage&& (value.sites.length!==expected.length||value.sites.some(site=>!expected.includes(site.facility_id))))ctx.addIssue({code:"custom",message:"Site projection does not match coverage"});
  if(value.availability==="unavailable"&&(value.coverage_complete||value.sites.some(site=>site.expectation!==null)))ctx.addIssue({code:"custom",message:"Unavailable detail must be withheld"});
  for(const site of value.sites){const e=site.expectation;if(e&&(e.facility_id!==site.facility_id||e.component_key!==value.activity_key||e.period_start!==value.period_start||e.period_end!==value.period_end))ctx.addIssue({code:"custom",message:"Nested expectation scope mismatch"});if(e){if(e.history_complete!==!e.history_cursor)ctx.addIssue({code:"custom",message:"History completeness/cursor mismatch"});const current=e.versions.find(v=>v.id===e.current_version_id);if(e.current_version_id&&(!current||(e.payload_included?!current.captured:current.captured!==null)))ctx.addIssue({code:"custom",message:"Current version payload boundary mismatch"});}}
  for(const m of value.meetings)if(m.snapshot.activity_key!==value.activity_key||m.snapshot.period_start!==value.period_start||m.snapshot.period_end!==value.period_end||m.coverage_revision!==m.snapshot.coverage.revision)ctx.addIssue({code:"custom",message:"Meeting projection scope mismatch"});
});
export type CorporateDeliverablesReply = z.infer<typeof corporateDeliverablesReplySchema>;
export const corporateDeliverableHistorySchema=z.object({task_id:uuid,expectation_id:uuid,versions:z.array(version.extend({captured:z.record(z.string(),z.unknown())})).max(1),events:z.array(event).max(50),next_before_version:z.number().int().nonnegative(),next_before_sequence:z.number().int().nonnegative(),complete:z.boolean()}).strict().superRefine((value,ctx)=>{if(value.complete!==(value.next_before_version===0&&value.next_before_sequence===0))ctx.addIssue({code:"custom",message:"History cursor completeness mismatch"});if(new Set(value.events.map(e=>e.id)).size!==value.events.length)ctx.addIssue({code:"custom",message:"Duplicate history event"});});
export type CorporateDeliverableHistory=z.infer<typeof corporateDeliverableHistorySchema>;
export const corporateUnresolvedComponentsSchema=z.object({components:z.array(z.object({component_key:z.literal("hfo-al-m09-02"),source_id:z.literal("AL-M09"),label:z.literal("FPC EOM review"),mapping_state:z.literal("unconfirmed"),subject_state:z.literal("unconfirmed"),source_state:z.literal("unavailable"),reason:z.string(),can_register:z.literal(false),can_prepare:z.literal(false)}).strict()).length(1)}).strict();
