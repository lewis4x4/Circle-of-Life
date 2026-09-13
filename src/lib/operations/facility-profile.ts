import { z } from "zod";
import { activityCatalog, type ActivityCatalog } from "./activity-catalog";
import profileData from "./facility-profile-data.json";
import { facilityRequirementDraftPayloadSchema } from "./requirements";
import { databaseUuidSchema } from "./database-uuid";

export type ProfileProvenance = { source: string; answer_id: string | null; approver_id: string | null; effective_from: string | null };
export type ProfileField = { status: "unknown" | "recorded" | "approved"; value: unknown; reason: string | null; provenance: ProfileProvenance[] };
export type ProfileFields = Record<"applicability" | "schedule" | "evidence" | "roles" | "backup" | "procedure", ProfileField>;
export type ProfileFacility = { id: string; name: string; organization_id: string; entity_id: string; entity_name: string; timezone: string | null };
export type ProfilePublication = {
  requirement: { id: string; version: number | null; source_authority: Record<string, unknown> | null; published_by: string | null; published_at: string | null; effective_from: string | null; effective_to: string | null } | null;
  configuration: { id: string; version: number | null; override_source: string | null; applicability_reason: string | null; approved_by: string | null; approved_at: string | null; effective_from: string | null; effective_to: string | null } | null;
};
export type ProfileComponent = { activity_id: string; label: string; kind: string; subject_kind: string | null; fields: ProfileFields; configuration_id: string | null; requirement_version_id: string | null; publication?: ProfilePublication; drafts: { requirement_id: string | null; configuration_id: string | null; status: "existing_drafts" | "published" | "not_prepared" | "needs_confirmation" }; recording: { available: boolean; reason: string } };
export type FacilityProfileReply = {
  facility: ProfileFacility;
  profile: { version: 1; identity_status: "verified" | "unconfigured" | "mismatch"; identity_provenance: ProfileProvenance[] };
  coverage: { source_count: number; component_count: number; mapping_unknown_count: number };
  entries: { source_id: string; source_text: string; source_sheet: string; source_cell: string; source_sha256: string; question_ids: string[]; disposition: "mapped" | "needs_confirmation"; confirmation_reason: string | null; components: ProfileComponent[] }[];
  summary: { approved_rule_count: number; unknown_rule_count: number; recorded_rule_count?: number };
  can_prepare_drafts: boolean;
  complete: true;
};
export type ProfileConfiguration = Record<string, unknown> & { id: string; facility_id: string; activity_id: string; requirement_version_id: string | null; status: string; effective_from: string | null; effective_to: string | null };
export type ProfileRequirement = Record<string, unknown> & { id: string; activity_id: string; status: string; effective_from: string | null; effective_to: string | null };

const uuid = databaseUuidSchema;
const provenanceSchema = z.object({ source: z.string().trim().min(1), answer_id: z.string().trim().min(1), approver_id: uuid, effective_from: z.iso.datetime({ offset: true }) }).strict();
export const profileRuleProposalSchema = z.object({ facility_id: uuid, activity_id: uuid, provenance: provenanceSchema, payload: facilityRequirementDraftPayloadSchema }).strict();
export type ProfileRuleProposal = z.infer<typeof profileRuleProposalSchema>;
export type ApprovedProfileRule = ProfileRuleProposal;

/** A well-shaped claim is not an approval. Require an exact reviewed server-side answer and payload. */
export function validateProfileRuleProposal(input: unknown, approved: readonly ApprovedProfileRule[] = []): { valid: boolean; problems: string[] } {
  const parsed = profileRuleProposalSchema.safeParse(input);
  if (!parsed.success) return { valid: false, problems: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) };
  const p = parsed.data;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const matches = approved.some(rule => profileRuleProposalSchema.safeParse(rule).success && canonical(rule) === canonical(p));
  return { valid: matches, problems: matches ? [] : ["No matching attributable approved rule is recorded. Preserve the proposal as unresolved; do not import or activate it."] };
}

function inForce(row: { status: string; effective_from: string | null; effective_to: string | null }, at: number): boolean {
  return row.status === "published" && row.effective_from !== null && Date.parse(row.effective_from) <= at && (row.effective_to === null || Date.parse(row.effective_to) > at);
}
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function publication(requirement: ProfileRequirement | undefined, config: ProfileConfiguration | undefined): ProfilePublication {
  const authority = requirement?.source_authority;
  return {
    requirement: requirement ? { id: requirement.id, version: typeof requirement.version === "number" ? requirement.version : null,
      source_authority: authority && typeof authority === "object" && !Array.isArray(authority) ? authority as Record<string, unknown> : null,
      published_by: text(requirement.published_by), published_at: text(requirement.published_at), effective_from: requirement.effective_from, effective_to: requirement.effective_to } : null,
    configuration: config ? { id: config.id, version: typeof config.version === "number" ? config.version : null,
      override_source: text(config.override_source), applicability_reason: text(config.applicability_reason), approved_by: text(config.approved_by),
      approved_at: text(config.approved_at), effective_from: config.effective_from, effective_to: config.effective_to } : null,
  };
}
/** Shared shape for every site. Catalog mapping never becomes policy approval or a due date. */
export function buildFacilityProfile(facility: ProfileFacility, configurations: ProfileConfiguration[], requirements: ProfileRequirement[], now = new Date(), canPrepareDrafts = false, catalog: ActivityCatalog = activityCatalog): FacilityProfileReply {
  const known = profileData.profiles.find(profile => profile.facility_id === facility.id);
  const identityMatches = known && known.organization_id === facility.organization_id && known.entity_id === facility.entity_id && known.timezone === facility.timezone;
  const identity_status = known ? identityMatches ? "verified" : "mismatch" : "unconfigured";
  const identity_provenance: ProfileProvenance[] = known ? [{ source: known.identity_source, answer_id: null, approver_id: null, effective_from: null }] : [];
  const entries: FacilityProfileReply["entries"] = catalog.entries.map(entry => ({
    source_id: entry.sourceId, source_text: entry.sourceText, source_sheet: entry.sourceSheet, source_cell: entry.sourceCell, source_sha256: catalog.source.sha256,
    question_ids: entry.questionIds, disposition: entry.disposition, confirmation_reason: entry.confirmationReason,
    components: entry.components.map(component => {
      const draftConfig = configurations.find(row => row.facility_id === facility.id && row.activity_id === component.id && row.status === "draft");
      const draftRequirement = requirements.find(row => row.activity_id === component.id && row.status === "draft");
      const config = configurations.find(row => row.facility_id === facility.id && row.activity_id === component.id && inForce(row, now.getTime()));
      // Preserve the actually referenced central record, including its dates. A
      // site's stale reference must not silently become a different version.
      const requirement = config?.requirement_version_id
        ? requirements.find(row => row.id === config.requirement_version_id && row.activity_id === component.id && row.status === "published")
        : requirements.find(row => row.activity_id === component.id && inForce(row, now.getTime()));
      const recorded = publication(requirement, config);
      const source: ProfileProvenance[] = [{ source: `${catalog.source.name} ${entry.sourceSheet}!${entry.sourceCell}`, answer_id: null, approver_id: null, effective_from: null }];
      const requirementSources: ProfileProvenance[] = recorded.requirement ? [...source, {
        source: text(recorded.requirement.source_authority?.source) ?? `Recorded central requirement ${recorded.requirement.id}`,
        answer_id: text(recorded.requirement.source_authority?.answer_id), approver_id: text(recorded.requirement.source_authority?.approver_id),
        effective_from: recorded.requirement.effective_from,
      }] : source;
      const configurationSources: ProfileProvenance[] = recorded.configuration ? [...source, {
        source: `Recorded facility configuration (${recorded.configuration.override_source ?? "source not recorded"})`, answer_id: null,
        approver_id: recorded.configuration.approved_by, effective_from: recorded.configuration.effective_from,
      }] : source;
      const field = (value: unknown, reason: string, provenance: ProfileProvenance[] = source): ProfileField => ({ status: value == null ? "unknown" : "recorded", value: value ?? null, reason: value == null ? reason : "Recorded configuration and attribution; independent business approval has not been established.", provenance });
      const fields: ProfileFields = {
        applicability: field(config?.applicability === "needs_confirmation" ? null : config?.applicability, "Facility applicability needs confirmation.", configurationSources),
        schedule: field(config?.schedule_status === "confirmed" ? config.schedule_rule : null, "Schedule needs confirmation; no due or overdue judgment.", configurationSources),
        evidence: field(config?.local_required_evidence ?? requirement?.required_evidence, "Required evidence needs confirmation.", config?.local_required_evidence != null ? configurationSources : requirementSources),
        roles: field(config || requirement ? { recorder_roles: config?.local_allowed_recorder_roles ?? requirement?.allowed_recorder_roles ?? null, owner_role: config?.owner_role ?? null, owner_user_id: config?.owner_user_id ?? null } : null, "Recorder roles and responsibility need confirmation.", [...requirementSources, ...configurationSources.slice(1)]),
        backup: field(config?.backup_user_id || config?.backup_role ? { user_id: config.backup_user_id ?? null, role: config.backup_role ?? null } : null, "Backup responsibility needs confirmation.", configurationSources),
        procedure: field((config?.local_procedure ?? requirement?.procedure) || null, "Procedure and equipment need confirmation.", config?.local_procedure != null ? configurationSources : requirementSources),
      };
      const direction = identityMatches ? known?.directions.find(item => item.activity_id === component.id) : undefined;
      if (direction && fields.schedule.status === "unknown") fields.schedule = { status: "unknown", value: { confirmed_direction: direction.statement }, reason: direction.unresolved, provenance: [{ source: direction.source, answer_id: null, approver_id: null, effective_from: null }] };
      return { activity_id: component.id, label: component.label, kind: component.kind, subject_kind: component.subjectKind, fields, configuration_id: config?.id ?? null, requirement_version_id: requirement?.id ?? null, publication: recorded,
        drafts: { requirement_id: draftRequirement?.id ?? null, configuration_id: draftConfig?.id ?? null, status: entry.disposition === "needs_confirmation" ? "needs_confirmation" : draftConfig || draftRequirement ? "existing_drafts" : config || requirement ? "published" : "not_prepared" },
        recording: { available: false, reason: requirement && !inForce(requirement, now.getTime()) ? "The referenced central version is not currently in force; review the configuration before recording." : requirement && config?.applicability === "applicable" ? "Actual recording without a due date is supported by the existing manual-occurrence command; current recorder and subject authority must be checked there." : "Actual recording without a due date is supported once a requirement/procedure, recorder authority and subject are established. Unknown schedules must not invent deadlines." } };
    }),
  }));
  const components = entries.flatMap(entry => entry.components);
  const approved = components.filter(component => Object.values(component.fields).every(field => field.status === "approved")).length;
  // Publication is a recorded fact, not independent evidence of business approval.
  const recordedCount = components.filter(component => component.publication?.requirement || component.publication?.configuration).length;
  return { facility, profile: { version: 1, identity_status, identity_provenance }, coverage: { source_count: entries.length, component_count: components.length, mapping_unknown_count: entries.filter(e => e.disposition === "needs_confirmation").length }, entries, summary: { approved_rule_count: approved, unknown_rule_count: components.length - approved, recorded_rule_count: recordedCount }, can_prepare_drafts: canPrepareDrafts, complete: true };
}
