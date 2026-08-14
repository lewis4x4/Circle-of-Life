import { describe, expect, it } from "vitest";

import {
  buildColDiscoveryPresetDefinition,
  COL_DISCOVERY_FACILITY_NAMES,
  LEGACY_MIGRATION_219_TEMPLATE_NAMES,
  planRulesFromPresetDefinition,
} from "./col-discovery-round-cadence";
import {
  fallbackObservationPlanTemplates,
  isChoosableObservationPlanTemplate,
  mapObservationPlanTemplateRow,
} from "./observation-plan-templates";

describe("observation plan templates", () => {
  it("excludes migration 219 template names from choosable defaults", () => {
    for (const name of LEGACY_MIGRATION_219_TEMPLATE_NAMES) {
      expect(
        isChoosableObservationPlanTemplate({
          name,
          active: true,
          preset_definition: buildColDiscoveryPresetDefinition("standard_day_night"),
        }),
      ).toBe(false);
    }
  });

  it("excludes pending plantation presets from choosable defaults", () => {
    expect(
      isChoosableObservationPlanTemplate({
        name: "COL Discovery Rounds (cadence pending)",
        active: true,
        preset_definition: buildColDiscoveryPresetDefinition("pending"),
      }),
    ).toBe(false);
  });

  it("maps active discovery templates to Jessica rules", () => {
    const mapped = mapObservationPlanTemplateRow({
      id: "template-1",
      name: "COL Discovery Rounds — Day + Night",
      description: "Jessica cadence",
      active: true,
      preset_definition: buildColDiscoveryPresetDefinition("standard_day_night"),
    });

    expect(mapped?.rules).toHaveLength(7);
    expect(mapped?.rules.every((rule) => rule.intervalMinutes !== 720)).toBe(true);
  });

  it("falls back to client discovery rules when database templates are unavailable", () => {
    const templates = fallbackObservationPlanTemplates(COL_DISCOVERY_FACILITY_NAMES.oakridge);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.rules).toHaveLength(7);
  });

  it("converts preset definitions to plan rules", () => {
    const rules = planRulesFromPresetDefinition(buildColDiscoveryPresetDefinition("homewood_two_hour_night"));
    expect(rules).toHaveLength(5);
    expect(rules.some((rule) => rule.intervalMinutes === 120 && rule.shift === "night")).toBe(true);
  });
});
