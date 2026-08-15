import { describe, expect, it } from "vitest";

import {
  buildColDiscoveryPresetDefinition,
  buildColDiscoveryRoundRules,
  COL_DISCOVERY_DAY_TIMES,
  describeColDiscoveryCadenceForFacility,
  resolveColDiscoveryDefaultRules,
  COL_DISCOVERY_FACILITY_NAMES,
  COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES,
  COL_DISCOVERY_NIGHT_TIMES_STANDARD,
  COL_DISCOVERY_ROUND_GRACE_MINUTES,
  COL_DISCOVERY_TEMPLATE_NAMES,
  extractDiscreteScheduledTime,
  getColDiscoveryCadenceProfile,
  isLegacyMigration219PresetDefinition,
  LEGACY_MIGRATION_219_TEMPLATE_NAMES,
  resolveColDiscoveryCadenceKey,
} from "./col-discovery-round-cadence";

describe("COL discovery round cadence — owner decision 2026-08-14", () => {
  it("maps each COL facility to the expected cadence profile", () => {
    expect(getColDiscoveryCadenceProfile("oakridge")).toBe("standard_day_night");
    expect(getColDiscoveryCadenceProfile("rising_oaks")).toBe("standard_day_night");
    expect(getColDiscoveryCadenceProfile("grande_cypress")).toBe("standard_day_night");
    expect(getColDiscoveryCadenceProfile("homewood")).toBe("homewood_two_hour_night");
    expect(getColDiscoveryCadenceProfile("plantation")).toBe("pending");
  });

  it("resolves facility display names to cadence keys", () => {
    expect(resolveColDiscoveryCadenceKey(COL_DISCOVERY_FACILITY_NAMES.oakridge)).toBe("oakridge");
    expect(resolveColDiscoveryCadenceKey(COL_DISCOVERY_FACILITY_NAMES.homewood)).toBe("homewood");
    expect(resolveColDiscoveryCadenceKey(COL_DISCOVERY_FACILITY_NAMES.plantation)).toBe("plantation");
    expect(resolveColDiscoveryCadenceKey("Unknown Site")).toBeNull();
  });

  it("locks Oakridge, Rising Oaks, and Grande Cypress to Jessica day + night discrete times", () => {
    for (const key of ["oakridge", "rising_oaks", "grande_cypress"] as const) {
      const rules = buildColDiscoveryRoundRules(getColDiscoveryCadenceProfile(key));
      const dayTimes = rules
        .filter((rule) => rule.shift === "day")
        .map((rule) => extractDiscreteScheduledTime(rule));
      const nightTimes = rules
        .filter((rule) => rule.shift === "night")
        .map((rule) => extractDiscreteScheduledTime(rule));

      expect(dayTimes).toEqual([...COL_DISCOVERY_DAY_TIMES]);
      expect(nightTimes).toEqual([...COL_DISCOVERY_NIGHT_TIMES_STANDARD]);
      expect(rules.every((rule) => rule.graceMinutes === COL_DISCOVERY_ROUND_GRACE_MINUTES)).toBe(true);
    }
  });

  it("locks Homewood to Jessica daytime times plus two-hour overnight interval", () => {
    const rules = buildColDiscoveryRoundRules("homewood_two_hour_night");
    const dayTimes = rules
      .filter((rule) => rule.shift === "day")
      .map((rule) => extractDiscreteScheduledTime(rule));
    const nightRule = rules.find((rule) => rule.shift === "night");

    expect(dayTimes).toEqual([...COL_DISCOVERY_DAY_TIMES]);
    expect(nightRule?.intervalType).toBe("fixed_minutes");
    expect(nightRule?.intervalMinutes).toBe(COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES);
    expect(nightRule?.daypartStart).toBe("18:00");
    expect(nightRule?.daypartEnd).toBe("06:00");
  });

  it("does not activate Plantation from cadence defaults", () => {
    expect(buildColDiscoveryRoundRules("pending")).toEqual([]);
    const preset = buildColDiscoveryPresetDefinition("pending");
    expect(preset.cadence_profile).toBe("pending");
    expect(preset.rules).toEqual([]);
  });

  it("flags migration 219 12-hour and Plantation wing presets as legacy", () => {
    expect(
      isLegacyMigration219PresetDefinition({
        template_type: "facility_default",
        rules: [{ interval_minutes: 720, interval_type: "fixed_minutes" }],
      }),
    ).toBe(true);

    expect(
      isLegacyMigration219PresetDefinition({
        template_type: "wing_default",
        wing_times: { "Wing 1": ["00:00", "08:00", "16:00"] },
        rules: [],
      }),
    ).toBe(true);

    expect(isLegacyMigration219PresetDefinition(buildColDiscoveryPresetDefinition("standard_day_night"))).toBe(false);
  });

  it("uses discovery template names instead of migration 219 defaults", () => {
    expect(COL_DISCOVERY_TEMPLATE_NAMES.standard_day_night).not.toBe(LEGACY_MIGRATION_219_TEMPLATE_NAMES[0]);
    expect(COL_DISCOVERY_TEMPLATE_NAMES.homewood_two_hour_night).not.toBe(LEGACY_MIGRATION_219_TEMPLATE_NAMES[1]);
    expect(COL_DISCOVERY_TEMPLATE_NAMES.pending).not.toBe(LEGACY_MIGRATION_219_TEMPLATE_NAMES[2]);
  });

  it("resolves default rules for COL facility display names without migration 219 cadence", () => {
    const oakridge = resolveColDiscoveryDefaultRules(COL_DISCOVERY_FACILITY_NAMES.oakridge);
    expect(oakridge.templateName).toBe(COL_DISCOVERY_TEMPLATE_NAMES.standard_day_night);
    expect(oakridge.rules.length).toBeGreaterThan(0);
    expect(oakridge.rules.every((rule) => rule.intervalMinutes !== 720)).toBe(true);

    const homewood = resolveColDiscoveryDefaultRules(COL_DISCOVERY_FACILITY_NAMES.homewood);
    expect(homewood.templateName).toBe(COL_DISCOVERY_TEMPLATE_NAMES.homewood_two_hour_night);
    expect(homewood.rules.some((rule) => rule.intervalMinutes === COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES)).toBe(
      true,
    );

    const plantation = resolveColDiscoveryDefaultRules(COL_DISCOVERY_FACILITY_NAMES.plantation);
    expect(plantation.templateName).toBe(COL_DISCOVERY_TEMPLATE_NAMES.pending);
    expect(plantation.rules).toEqual([]);
  });

  it("describes Jessica cadence in plain English for configured facilities", () => {
    const oakridge = describeColDiscoveryCadenceForFacility(COL_DISCOVERY_FACILITY_NAMES.oakridge);
    expect(oakridge.canApply).toBe(true);
    expect(oakridge.headline).toContain("day and night");
    expect(oakridge.detail).toContain("6 AM");
    expect(oakridge.detail).toContain("5:30 PM");
    expect(oakridge.detail).toContain("10 PM");
    expect(oakridge.detail).toContain("Eastern");

    const homewood = describeColDiscoveryCadenceForFacility(COL_DISCOVERY_FACILITY_NAMES.homewood);
    expect(homewood.canApply).toBe(true);
    expect(homewood.headline).toContain("two-hour night");
    expect(homewood.detail).toContain("two-hour overnight checks");

    const plantation = describeColDiscoveryCadenceForFacility(COL_DISCOVERY_FACILITY_NAMES.plantation);
    expect(plantation.canApply).toBe(false);
    expect(plantation.detail).toContain("pending owner decision");
    expect(plantation.detail).not.toContain("6:00");
  });
});
