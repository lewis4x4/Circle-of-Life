import type { ModulePromoter, ModuleValues, PromotionContext, PromotionResult } from "./_types.ts";
import {
  asBoolean,
  asInteger,
  asString,
  compactTables,
  insertPromotionLink,
  isEmptyOperationalValue,
  isMeaningful,
  moduleValueId,
  parseDateOrNull,
  partialSafetyWarning,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";

type FieldMapping = {
  source: string;
  column: string;
  coerce: (value: unknown) => unknown;
};

const FIELD_MAPPINGS: FieldMapping[] = [
  { source: "legalName", column: "legal_name", coerce: asString },
  { source: "dba", column: "dba", coerce: asString },
  { source: "facilityType", column: "facility_type", coerce: asString },
  { source: "licenseNumber", column: "license_number", coerce: asString },
  { source: "licenseState", column: "license_state", coerce: asString },
  { source: "licenseAgency", column: "license_agency", coerce: asString },
  { source: "physicalAddress", column: "physical_address", coerce: asString },
  { source: "facilityAddress", column: "facility_address", coerce: asString },
  { source: "mailingAddress", column: "mailing_address", coerce: asString },
  { source: "mainPhone", column: "main_phone", coerce: asString },
  { source: "afterHoursPhone", column: "after_hours_phone", coerce: asString },
  { source: "capacity", column: "capacity", coerce: asInteger },
  { source: "floorsWings", column: "floors_wings", coerce: asString },
  { source: "executiveDirector", column: "executive_director_name", coerce: asString },
  { source: "don", column: "don_name", coerce: asString },
  { source: "maintenanceDirector", column: "maintenance_director_name", coerce: asString },
  { source: "businessOfficeManager", column: "business_office_manager_name", coerce: asString },
  { source: "emergencyContact", column: "emergency_contact_name", coerce: asString },
  { source: "operatingAddressConfirmed", column: "operating_address_confirmed", coerce: asBoolean },
];

const READY_FIELDS = ["licenseExpiration", ...FIELD_MAPPINGS.map((field) => field.source)];

export const M2_PROMOTER: ModulePromoter = {
  moduleCode: "M2",
  description: "Promote Facility Launch facility profile fields to the facility row.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    return { ready: READY_FIELDS.some((field) => isMeaningful(values[field])), missing: [] };
  },
  async promote(ctx: PromotionContext, values: ModuleValues): Promise<PromotionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const { data: facility, error: readError } = await ctx.admin
      .from("facilities")
      .select("*")
      .eq("id", ctx.facility_id)
      .eq("organization_id", ctx.organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (readError) throw new Error(`M2 facility read failed: ${readError.message}`);
    if (!facility) {
      return {
        module_code: "M2",
        status: "failed",
        summary: "Facility row not found.",
        tables_touched: compactTables([tableCount("facilities")]),
        warnings,
        errors: ["Facility row not found."],
        prerequisites_unmet: ["facility"],
      };
    }

    const before = facility as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const appliedFields: Array<{ source: string; column: string; before: unknown; after: unknown }> = [];
    let noops = 0;

    for (const mapping of FIELD_MAPPINGS) {
      if (!isMeaningful(values[mapping.source])) continue;
      const next = mapping.coerce(values[mapping.source]);
      if (next === null || next === undefined) continue;
      const existing = before[mapping.column];
      if (!isEmptyOperationalValue(existing) && valuesDiffer(existing, next)) {
        warnings.push(partialSafetyWarning(mapping.column, existing, next));
        continue;
      }
      if (valuesDiffer(existing, next)) {
        patch[mapping.column] = next;
        appliedFields.push({ source: mapping.source, column: mapping.column, before: existing, after: next });
      } else {
        noops += 1;
      }
    }

    if (isMeaningful(values.licenseExpiration)) {
      const parsed = parseDateOrNull(values.licenseExpiration);
      if (parsed.warning) warnings.push(`license_expiration ${parsed.warning}`);
      if (parsed.date) {
        const existing = before.license_expiration;
        if (!isEmptyOperationalValue(existing) && valuesDiffer(existing, parsed.date)) {
          warnings.push(partialSafetyWarning("license_expiration", existing, parsed.date));
        } else if (valuesDiffer(existing, parsed.date)) {
          patch.license_expiration = parsed.date;
          appliedFields.push({ source: "licenseExpiration", column: "license_expiration", before: existing, after: parsed.date });
        } else {
          noops += 1;
        }
      }
    }

    if (!ctx.dry_run && Object.keys(patch).length > 0) {
      const { error: updateError } = await ctx.admin
        .from("facilities")
        .update({ ...patch, updated_by: ctx.actor_user_id })
        .eq("id", ctx.facility_id)
        .eq("organization_id", ctx.organization_id);
      if (updateError) throw new Error(`M2 facility update failed: ${updateError.message}`);

      for (const field of appliedFields) {
        await insertPromotionLink(ctx, {
          target_table: "facilities",
          target_row_id: ctx.facility_id,
          action: "update",
          before_value: { [field.column]: field.before },
          after_value: { [field.column]: field.after },
          module_value_id: moduleValueId(ctx, field.source),
        });
      }
    }

    const rowsUpdated = Object.keys(patch).length > 0 ? 1 : 0;
    const status = rowsUpdated > 0 ? "promoted" : warnings.length > 0 ? "partial" : "promoted";
    return {
      module_code: "M2",
      status,
      summary: rowsUpdated > 0 ? `Facility profile updated (${appliedFields.length} field(s)).` : "Facility profile already current or skipped by partial-safety.",
      tables_touched: compactTables([tableCount("facilities", 0, rowsUpdated, noops > 0 && rowsUpdated === 0 ? 1 : 0)]),
      warnings,
      errors,
      prerequisites_unmet: [],
    };
  },
};
