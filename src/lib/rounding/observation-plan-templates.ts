import {
  isLegacyMigration219PresetDefinition,
  isLegacyMigration219TemplateName,
  planRulesFromPresetDefinition,
  resolveColDiscoveryDefaultRules,
} from "@/lib/rounding/col-discovery-round-cadence";
import type { PlanRuleInput } from "@/lib/rounding/types";

export type ObservationPlanTemplateOption = {
  id: string;
  name: string;
  description: string | null;
  cadenceProfile: string | null;
  rules: PlanRuleInput[];
};

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  preset_definition: Record<string, unknown> | null;
  active: boolean;
};

export function isChoosableObservationPlanTemplate(row: Pick<TemplateRow, "name" | "preset_definition" | "active">): boolean {
  if (!row.active) return false;
  if (isLegacyMigration219TemplateName(row.name)) return false;
  if (isLegacyMigration219PresetDefinition(row.preset_definition)) return false;

  const profile = row.preset_definition?.cadence_profile;
  if (profile === "pending") return false;

  return planRulesFromPresetDefinition(row.preset_definition).length > 0;
}

export function mapObservationPlanTemplateRow(row: TemplateRow): ObservationPlanTemplateOption | null {
  if (!isChoosableObservationPlanTemplate(row)) return null;

  const preset = row.preset_definition ?? {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cadenceProfile: typeof preset.cadence_profile === "string" ? preset.cadence_profile : null,
    rules: planRulesFromPresetDefinition(preset),
  };
}

export function fallbackObservationPlanTemplates(facilityName: string): ObservationPlanTemplateOption[] {
  const defaults = resolveColDiscoveryDefaultRules(facilityName);
  if (!defaults.templateName || defaults.rules.length === 0) return [];

  return [
    {
      id: `col-discovery-${defaults.profile ?? "default"}`,
      name: defaults.templateName,
      description: "Jessica discovery-round cadence (owner 2026-08-14).",
      cadenceProfile: defaults.profile,
      rules: defaults.rules,
    },
  ];
}
