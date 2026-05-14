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
  "incidentPolicySource",
  "claimsRoutingOwner",
  "stateReportingRule",
];

export const M16_PROMOTER: ModulePromoter = {
  moduleCode: "M16",
  description:
    "Promote incident/risk configuration and workflow templates discovered during Facility Launch.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    const ready = hasAnyMeaningful(values, CONFIG_FIELDS) ||
      recordArray(values, "incidentWorkflows").length > 0;
    return {
      ready,
      missing: ready ? [] : [...CONFIG_FIELDS, "incidentWorkflows"],
    };
  },
  async promote(
    ctx: PromotionContext,
    values: ModuleValues,
  ): Promise<PromotionResult> {
    const configCounts = await promoteConfigFields(ctx, values, {
      moduleCode: "M16",
      table: "facility_incident_config",
      fields: CONFIG_FIELDS,
      summaryLabel: "Incident configuration",
    });
    const workflowCounts = await promoteCollectionRows(ctx, "M16", {
      table: "incident_workflow_templates",
      sourceFieldPath: "incidentWorkflows",
      rows: recordArray(values, "incidentWorkflows"),
      naturalKey: (row) => ({
        incident_type: stringField(row, "incidentType", "incident_type"),
      }),
      label: (row) =>
        stringField(row, "incidentType", "incident_type", "id") ??
          "workflow template",
      payload: (row) => ({
        source_template_id: stringField(row, "id"),
        incident_type: stringField(row, "incidentType", "incident_type"),
        severity_rule: stringField(row, "severityRule", "severity_rule"),
        immediate_actions: stringField(
          row,
          "immediateActions",
          "immediate_actions",
        ),
        family_notification_rule: stringField(
          row,
          "familyNotificationRule",
          "family_notification_rule",
        ),
        state_reporting_threshold: stringField(
          row,
          "stateReportingThreshold",
          "state_reporting_threshold",
        ),
        claims_routing: stringField(row, "claimsRouting", "claims_routing"),
        investigation_owner: stringField(
          row,
          "investigationOwner",
          "investigation_owner",
        ),
        follow_up_cadence: stringField(
          row,
          "followUpCadence",
          "follow_up_cadence",
        ),
      }),
    });
    return configPromotionResult(
      "M16",
      "facility_incident_config",
      "Incident/risk configuration",
      configCounts,
      [
        { table: "incident_workflow_templates", counts: workflowCounts },
      ],
      ctx.dry_run,
    );
  },
};
