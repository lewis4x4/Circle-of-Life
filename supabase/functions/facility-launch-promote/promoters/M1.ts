import type { ModulePromoter, ModuleValues, PromotionContext, PromotionResult } from "./_types.ts";
import {
  asString,
  compactTables,
  insertPromotionLink,
  isMeaningful,
  mergeMetadata,
  moduleValueId,
  partialSafetyWarning,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";

const READY_FIELDS = [
  "parentLegalName",
  "dba",
  "operatingLlc",
  "propertyLlc",
  "mailingAddress",
  "timeZone",
  "corporateContact",
  "billingContact",
  "legalEntities",
];

function metadataPatch(values: ModuleValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const mappings: Array<[string, string]> = [
    ["parentLegalName", "parent_legal_name"],
    ["dba", "dba"],
    ["mailingAddress", "mailing_address"],
    ["corporateContact", "corporate_contact"],
    ["billingContact", "billing_contact"],
    ["operatingLlc", "operating_llc"],
    ["propertyLlc", "property_llc"],
    ["legalEntities", "legal_entities"],
  ];
  for (const [source, target] of mappings) {
    if (isMeaningful(values[source])) patch[target] = values[source];
  }
  return patch;
}

export const M1_PROMOTER: ModulePromoter = {
  moduleCode: "M1",
  description: "Promote Facility Launch company/portfolio profile metadata to organization.",
  prerequisites: [],
  canPromote(values: ModuleValues) {
    return { ready: READY_FIELDS.some((field) => isMeaningful(values[field])), missing: [] };
  },
  async promote(ctx: PromotionContext, values: ModuleValues): Promise<PromotionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const { data: organization, error: readError } = await ctx.admin
      .from("organizations")
      .select("id, timezone, launch_profile_metadata")
      .eq("id", ctx.organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (readError) throw new Error(`M1 organization read failed: ${readError.message}`);
    if (!organization) {
      return {
        module_code: "M1",
        status: "failed",
        summary: "Organization not found.",
        tables_touched: compactTables([tableCount("organizations")]),
        warnings,
        errors: ["Organization not found."],
        prerequisites_unmet: ["organization"],
      };
    }

    const before = organization as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const metadata = metadataPatch(values);
    const existingMetadata = mergeMetadata(before.launch_profile_metadata, {});
    const mergedMetadata = mergeMetadata(existingMetadata, metadata);
    if (valuesDiffer(existingMetadata, mergedMetadata)) patch.launch_profile_metadata = mergedMetadata;

    const intakeTimeZone = asString(values.timeZone);
    if (intakeTimeZone) {
      const existingTimeZone = asString(before.timezone);
      if (existingTimeZone && valuesDiffer(existingTimeZone, intakeTimeZone)) {
        warnings.push(partialSafetyWarning("timezone", existingTimeZone, intakeTimeZone));
        mergedMetadata.time_zone = intakeTimeZone;
        patch.launch_profile_metadata = mergedMetadata;
      } else if (!existingTimeZone) {
        patch.timezone = intakeTimeZone;
      }
    }

    const changedFieldPaths = READY_FIELDS.filter((field) => isMeaningful(values[field])).filter((field) => {
      if (field === "timeZone") {
        return !warnings.some((warning) => warning.startsWith("timezone has existing value")) && valuesDiffer(before.timezone, asString(values.timeZone));
      }
      const target = field === "parentLegalName" ? "parent_legal_name"
        : field === "mailingAddress" ? "mailing_address"
        : field === "corporateContact" ? "corporate_contact"
        : field === "billingContact" ? "billing_contact"
        : field === "operatingLlc" ? "operating_llc"
        : field === "propertyLlc" ? "property_llc"
        : field === "legalEntities" ? "legal_entities"
        : field;
      return valuesDiffer(existingMetadata[target], mergedMetadata[target]);
    });

    const rowsNoop = changedFieldPaths.length === 0 ? 1 : 0;
    if (!ctx.dry_run && Object.keys(patch).length > 0 && changedFieldPaths.length > 0) {
      const { error: updateError } = await ctx.admin
        .from("organizations")
        .update({ ...patch, updated_by: ctx.actor_user_id })
        .eq("id", ctx.organization_id);
      if (updateError) throw new Error(`M1 organization update failed: ${updateError.message}`);

      for (const fieldPath of changedFieldPaths) {
        await insertPromotionLink(ctx, {
          target_table: "organizations",
          target_row_id: ctx.organization_id,
          action: "update",
          before_value: before,
          after_value: patch,
          module_value_id: moduleValueId(ctx, fieldPath),
        });
      }
    }

    const rowsUpdated = changedFieldPaths.length > 0 ? 1 : 0;
    return {
      module_code: "M1",
      status: "promoted",
      summary: rowsUpdated > 0 ? "Organization launch profile updated." : "Organization launch profile already current.",
      tables_touched: compactTables([tableCount("organizations", 0, rowsUpdated, rowsNoop)]),
      warnings,
      errors,
      prerequisites_unmet: [],
    };
  },
};
