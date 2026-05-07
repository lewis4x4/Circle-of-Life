import { z } from "zod";

/**
 * V2 form schemas — RHF resolvers + page-level type sources.
 *
 * S10 ships the form skeletons (validation + UI). Submit handlers post to
 * `/api/v2/forms/[id]` which today returns a `deferred` envelope without
 * persisting; the live wire-up to the existing V1 create endpoints lands
 * in S10a alongside per-entity audit + redirect handling.
 */

export const newResidentFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(120),
  lastName: z.string().trim().min(1, "Last name is required").max(120),
  facilityId: z.string().uuid("Pick a facility"),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  primaryDiagnosis: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type NewResidentFormValues = z.infer<typeof newResidentFormSchema>;

export const newAdmissionFormSchema = z.object({
  residentId: z.string().uuid("Pick a resident"),
  facilityId: z.string().uuid("Pick a facility"),
  targetMoveInDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type NewAdmissionFormValues = z.infer<typeof newAdmissionFormSchema>;

export const incidentSeverity = z.enum(["low", "medium", "high", "critical"]);

export const newIncidentFormSchema = z.object({
  facilityId: z.string().uuid("Pick a facility"),
  residentId: z.string().uuid().optional().or(z.literal("")),
  category: z.string().trim().min(1, "Category is required"),
  severity: incidentSeverity,
  occurredAt: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
      "YYYY-MM-DDTHH:mm",
    ),
  locationDescription: z.string().trim().max(500).optional().or(z.literal("")),
  description: z.string().trim().min(10, "Describe what happened (10+ chars)").max(4000),
  // RHF supplies defaults; the schema enforces a literal boolean at submit.
  injuryOccurred: z.boolean(),
  ahcaReportable: z.boolean(),
});
export type NewIncidentFormValues = z.infer<typeof newIncidentFormSchema>;

/** Same shape as {@link newIncidentFormSchema} but `occurredAt` is UTC ISO (Z) for API ingestion. */
export const newIncidentApiSchema = newIncidentFormSchema.omit({ occurredAt: true }).extend({
  occurredAt: z.iso.datetime(),
});
export type NewIncidentApiValues = z.infer<typeof newIncidentApiSchema>;

/**
 * `<input type="datetime-local">` values are wall-clock in the browser's local TZ with no offset.
 * Parsing that string on the server uses the host TZ (UTC on Netlify), which skews `occurred_at`.
 */
export function datetimeLocalToUtcIso(datetimeLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(datetimeLocal);
  if (!m) {
    throw new Error("datetimeLocal must match YYYY-MM-DDTHH:mm");
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  return new Date(y, mo - 1, d, h, min).toISOString();
}

export type V2FormId = "new-resident" | "new-admission" | "new-incident";
export const V2_FORM_IDS: readonly V2FormId[] = [
  "new-resident",
  "new-admission",
  "new-incident",
] as const;

export function isV2FormId(value: string): value is V2FormId {
  return (V2_FORM_IDS as readonly string[]).includes(value);
}
