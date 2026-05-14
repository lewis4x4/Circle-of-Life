import type {
  ModulePromoter,
  ModuleValues,
  PromotionContext,
  PromotionResult,
} from "./_types.ts";
import {
  configPromotionResult,
  hasAnyMeaningful,
  promoteCollectionRows,
  promoteConfigFields,
  recordArray,
  stringField,
} from "./_config.ts";

const CONFIG_FIELDS = [
  "executiveDashboardAudience",
  "reportCadence",
  "kpiOwner",
];

export const M19_PROMOTER: ModulePromoter = {
  moduleCode: "M19",
  description:
    "Promote launch scoreboard configuration and KPI definitions discovered during Facility Launch.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    const ready = hasAnyMeaningful(values, CONFIG_FIELDS) ||
      recordArray(values, "kpiDefinitions").length > 0;
    return {
      ready,
      missing: ready ? [] : [...CONFIG_FIELDS, "kpiDefinitions"],
    };
  },
  async promote(
    ctx: PromotionContext,
    values: ModuleValues,
  ): Promise<PromotionResult> {
    const configCounts = await promoteConfigFields(ctx, values, {
      moduleCode: "M19",
      table: "facility_launch_scoreboard_config",
      fields: CONFIG_FIELDS,
      summaryLabel: "Launch scoreboard configuration",
    });
    const kpiCounts = await promoteCollectionRows(ctx, "M19", {
      table: "facility_kpi_definitions",
      sourceFieldPath: "kpiDefinitions",
      rows: recordArray(values, "kpiDefinitions"),
      naturalKey: (row) => ({
        kpi_name: stringField(row, "kpiName", "kpi_name"),
      }),
      label: (row) =>
        stringField(row, "kpiName", "kpi_name", "id") ?? "KPI definition",
      payload: (row) => ({
        source_kpi_id: stringField(row, "id"),
        kpi_name: stringField(row, "kpiName", "kpi_name"),
        business_question: stringField(
          row,
          "businessQuestion",
          "business_question",
        ),
        data_source: stringField(row, "dataSource", "data_source"),
        owner: stringField(row, "owner"),
        refresh_cadence: stringField(row, "refreshCadence", "refresh_cadence"),
        target: stringField(row, "target"),
        launch_threshold: stringField(
          row,
          "launchThreshold",
          "launch_threshold",
        ),
        action_if_off_track: stringField(
          row,
          "actionIfOffTrack",
          "action_if_off_track",
        ),
      }),
    });
    return configPromotionResult(
      "M19",
      "facility_launch_scoreboard_config",
      "Launch scoreboard configuration",
      configCounts,
      [
        { table: "facility_kpi_definitions", counts: kpiCounts },
      ],
      ctx.dry_run,
    );
  },
};
