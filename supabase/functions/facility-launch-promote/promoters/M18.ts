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

const CONFIG_FIELDS = ["vendorSource", "afterHoursVendorRule", "vendorOwner"];

function vendorSourceId(row: Record<string, unknown>): string | null {
  return stringField(row, "id", "sourceVendorId", "source_vendor_id");
}

export const M18_PROMOTER: ModulePromoter = {
  moduleCode: "M18",
  description:
    "Promote vendor/emergency contact configuration and vendor directory summaries discovered during Facility Launch.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    const ready = hasAnyMeaningful(values, CONFIG_FIELDS) ||
      recordArray(values, "vendorContacts").length > 0;
    return {
      ready,
      missing: ready ? [] : [...CONFIG_FIELDS, "vendorContacts"],
    };
  },
  async promote(
    ctx: PromotionContext,
    values: ModuleValues,
  ): Promise<PromotionResult> {
    const configCounts = await promoteConfigFields(ctx, values, {
      moduleCode: "M18",
      table: "facility_vendor_config",
      fields: CONFIG_FIELDS,
      summaryLabel: "Vendor configuration",
    });
    const vendorCounts = await promoteCollectionRows(ctx, "M18", {
      table: "facility_vendors",
      sourceFieldPath: "vendorContacts",
      rows: recordArray(values, "vendorContacts"),
      rpcFunction: "promote_facility_launch_vendor_contacts",
      naturalKey: (row) => {
        const sourceVendorId = vendorSourceId(row);
        const key: Record<string, string | null> = sourceVendorId
          ? { source_vendor_id: sourceVendorId }
          : {
            organization: stringField(row, "organization"),
            category: stringField(row, "category"),
            phone: stringField(row, "phone"),
          };
        return key;
      },
      label: (row) =>
        stringField(row, "organization", "id") ?? "vendor contact",
      nullLookupColumns: (row) => vendorSourceId(row) ? [] : ["source_vendor_id"],
      payload: (row) => {
        const sourceVendorId = vendorSourceId(row);
        return {
          source_vendor_id: sourceVendorId,
          organization: stringField(row, "organization"),
          category: stringField(row, "category"),
          primary_contact: stringField(row, "primaryContact", "primary_contact"),
          phone: stringField(row, "phone"),
          after_hours_phone: stringField(
            row,
            "afterHoursPhone",
            "after_hours_phone",
          ),
          account_number: stringField(row, "accountNumber", "account_number"),
          contract_status: stringField(row, "contractStatus", "contract_status"),
          insurance_required: stringField(
            row,
            "insuranceRequired",
            "insurance_required",
          ),
          escalation_owner: stringField(
            row,
            "escalationOwner",
            "escalation_owner",
          ),
        };
      },
    });
    return configPromotionResult(
      "M18",
      "facility_vendor_config",
      "Vendor/emergency configuration",
      configCounts,
      [
        { table: "facility_vendors", counts: vendorCounts },
      ],
      ctx.dry_run,
    );
  },
};
