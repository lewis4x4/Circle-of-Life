import { z } from "zod";

import catalogData from "./activity-catalog.json";

export const ACTIVITY_KINDS = [
  "attestation",
  "structured_observation",
  "record_review",
  "event_checklist",
  "data_field",
  "linked_domain_action",
] as const;

export const ACTIVITY_SUBJECT_KINDS = ["facility", "resident", "employee", "asset"] as const;

const subjectKind = z.enum(ACTIVITY_SUBJECT_KINDS).nullable();
const nonblank = z.string().refine((value) => value.trim().length > 0, "Must not be blank");
const componentSchema = z.object({
  // Persist these allocated identities when wording or source versions change.
  // Neither an activity key nor its UUID is recalculated from the source label.
  key: z.string().regex(/^hfo-[a-z0-9-]+$/),
  id: z.uuid(),
  label: nonblank,
  kind: z.enum(ACTIVITY_KINDS),
  subjectKind,
}).strict();

const entrySchema = z.object({
  sourceId: z.string().regex(/^AL-[DWMAQYNCEH]\d{2}$/),
  sourceSheet: nonblank,
  sourceCell: z.string().regex(/^[A-Z]+[1-9]\d*$/),
  sourceText: nonblank,
  sourceTimingEvidence: nonblank,
  questionIds: z.array(z.string().regex(/^Q\d{2}$/)).min(1),
  proposedCapture: nonblank,
  disposition: z.enum(["mapped", "needs_confirmation"]),
  kind: z.enum(ACTIVITY_KINDS),
  subjectKind,
  confirmationReason: nonblank.nullable(),
  components: z.array(componentSchema).min(1),
  // Catalog mapping is design provenance, never evidence of performed work.
  status: z.literal("draft"),
  approvedRule: z.null(),
  effortMinutes: z.null(),
}).strict().superRefine((entry, ctx) => {
  if ((entry.disposition === "needs_confirmation") !== (entry.confirmationReason !== null)) {
    ctx.addIssue({ code: "custom", path: ["confirmationReason"], message: "Unconfirmed mappings require a reason; mapped rows must not have one" });
  }
  if (entry.disposition === "mapped" &&
      (entry.subjectKind === null || entry.components.some((component) => component.subjectKind === null))) {
    ctx.addIssue({ code: "custom", path: ["disposition"], message: "Unknown subjects require confirmation" });
  }
});

// Named header counts, not populated Y/N cells or inferred blank-header duties.
const sourceGroups = { D: 19, W: 8, M: 12, A: 11, Q: 1, Y: 7, N: 9, C: 9, E: 14, H: 1 } as const;
export const ADMIN_LOG_SOURCE_IDS: readonly string[] = Object.entries(sourceGroups).flatMap(
  ([group, count]) => Array.from({ length: count }, (_, index) => `AL-${group}${String(index + 1).padStart(2, "0")}`),
);

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogKey: nonblank,
  source: z.object({
    name: nonblank,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    inventoryIntakeId: nonblank,
  }).strict(),
  entries: z.array(entrySchema).length(91),
}).strict().superRefine((catalog, ctx) => {
  const sourceIds = new Set<string>();
  const sourceCells = new Set<string>();
  const componentKeys = new Set<string>();
  const componentIds = new Set<string>();
  const expectedIds = new Set(ADMIN_LOG_SOURCE_IDS);
  catalog.entries.forEach((entry, index) => {
    if (sourceIds.has(entry.sourceId) || !expectedIds.has(entry.sourceId)) {
      ctx.addIssue({ code: "custom", path: ["entries", index, "sourceId"], message: "Duplicate or unknown Admin Log source ID" });
    }
    sourceIds.add(entry.sourceId);
    const cellKey = `${entry.sourceSheet}!${entry.sourceCell}`;
    if (sourceCells.has(cellKey)) {
      ctx.addIssue({ code: "custom", path: ["entries", index, "sourceCell"], message: "Duplicate source cell" });
    }
    sourceCells.add(cellKey);
    entry.components.forEach((component, componentIndex) => {
      for (const [field, values] of [["key", componentKeys], ["id", componentIds]] as const) {
        if (values.has(component[field])) {
          ctx.addIssue({ code: "custom", path: ["entries", index, "components", componentIndex, field], message: "Duplicate activity identity" });
        }
        values.add(component[field]);
      }
    });
  });
  for (const sourceId of expectedIds) {
    if (!sourceIds.has(sourceId)) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: `Missing source mapping: ${sourceId}` });
    }
  }
});

export type ActivityCatalog = z.infer<typeof catalogSchema>;
export type ActivityCatalogEntry = ActivityCatalog["entries"][number];
export type ActivityCatalogComponent = ActivityCatalogEntry["components"][number];

/** Validates the bounded draft intake. It does not create schedules or work receipts. */
export function parseActivityCatalog(input: unknown): ActivityCatalog {
  return catalogSchema.parse(input);
}

export const activityCatalog = parseActivityCatalog(catalogData);
