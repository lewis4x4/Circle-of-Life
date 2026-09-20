import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyMode, RungDraft, WindowDraft } from "./cadence-settings";

export type ObservationTemplate = { id: string; name: string; template_key: string; version_id: string; version_number: number; windows?: WindowDraft[]; rungs?: RungDraft[] };
export type TemplateCatalog = { cadence_templates: ObservationTemplate[]; escalation_templates: ObservationTemplate[] };
export type PortfolioFacility = { facility_id: string; facility_name: string; cadence_template_id: string | null; cadence_template_name: string | null; escalation_template_id: string | null; escalation_template_name: string | null; cadence_drift_count: number; escalation_drift_count: number };
export type TemplateOutcome = { facility_id: string; ok: boolean; reason?: string; effective_from?: string };

export async function fetchTemplatePortfolio(client: SupabaseClient, facilityId: string) {
  const [catalog, portfolio] = await Promise.all([
    client.rpc("observation_config_templates", { p_facility_id: facilityId }),
    client.from("v_facility_config_template_drift").select("facility_id,facility_name,cadence_template_id,cadence_template_name,escalation_template_id,escalation_template_name,cadence_drift_count,escalation_drift_count"),
  ]);
  if (catalog.error) throw catalog.error;
  if (portfolio.error) throw portfolio.error;
  if (!catalog.data || !portfolio.data) throw new Error("Template portfolio returned no data");
  return { catalog: catalog.data as TemplateCatalog, portfolio: portfolio.data as PortfolioFacility[] };
}

export async function saveObservationTemplate(client: SupabaseClient, args: { facilityId: string; kind: "cadence" | "escalation"; name: string; reason: string; rows: WindowDraft[] | RungDraft[]; templateId: string | null }) {
  const { data, error } = await client.rpc("save_observation_template", { p_facility_id: args.facilityId, p_kind: args.kind, p_name: args.name, p_change_reason: args.reason, p_rows: args.rows, p_template_id: args.templateId });
  if (error) throw error;
  if (!data) throw new Error("Template revision was not returned");
  return data as { template_id: string; version_id: string; version_number: number };
}

export async function applyObservationTemplate(client: SupabaseClient, args: { facilityId: string; templateId: string; expectedVersionId: string; kind: "cadence" | "escalation"; reason: string; applyMode: ApplyMode; effectiveFrom: string | null; acknowledgment: string }) {
  const { data, error } = await client.rpc("apply_template_to_facilities", {
    p_facility_ids: [args.facilityId], p_change_reason: args.reason,
    p_cadence_template_id: args.kind === "cadence" ? args.templateId : null,
    p_escalation_template_id: args.kind === "escalation" ? args.templateId : null,
    p_expected_cadence_template_version_id: args.kind === "cadence" ? args.expectedVersionId : null,
    p_expected_escalation_template_version_id: args.kind === "escalation" ? args.expectedVersionId : null,
    p_apply_mode: args.applyMode, p_effective_from: args.effectiveFrom, p_acknowledgment: args.acknowledgment,
  });
  if (error) throw error;
  const outcomes = (data as { facilities?: TemplateOutcome[] } | null)?.facilities;
  const outcome = outcomes?.find((row) => row.facility_id === args.facilityId);
  if (!outcome) throw new Error("No result was returned for this facility");
  return outcome;
}
