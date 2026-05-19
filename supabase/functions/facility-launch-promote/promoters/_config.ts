import type {
  ModuleValues,
  PromotionContext,
  PromotionResult,
} from "./_types.ts";
import {
  asRecord,
  asString,
  compactTables,
  insertPromotionLink,
  isMeaningful,
  moduleValueId,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";

type Row = Record<string, unknown>;

export type ConfigPromoterSpec = {
  moduleCode: string;
  table: string;
  fields: string[];
  summaryLabel: string;
};

export type CollectionPromoteSpec = {
  table: string;
  sourceFieldPath: string;
  rows: Row[];
  naturalKey: (row: Row) => Record<string, string | null>;
  payload: (row: Row) => Row;
  label: (row: Row) => string;
};

export type PromotionCounts = {
  created: number;
  updated: number;
  noop: number;
  warnings: string[];
};

function sourceProvenance(moduleCode: string, fieldPath: string): Row {
  return {
    source: "facility-launch-promote",
    module_code: moduleCode,
    field_path: fieldPath,
  };
}

function payloadDiffers(existing: Row, payload: Row): boolean {
  return Object.entries(payload).some(([key, value]) =>
    valuesDiffer(existing[key], value)
  );
}

async function findConfigRow(
  ctx: PromotionContext,
  table: string,
  fieldPath: string,
): Promise<Row | null> {
  const { data, error } = await ctx.admin
    .from(table)
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("field_path", fieldPath)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(
      `${table} lookup failed for ${fieldPath}: ${error.message}`,
    );
  }
  return data as Row | null;
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function findCollectionRow(
  ctx: PromotionContext,
  table: string,
  naturalKey: Record<string, string | null>,
): Promise<Row | null> {
  let query = ctx.admin
    .from(table)
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .is("deleted_at", null);
  for (const [column, value] of Object.entries(naturalKey)) {
    if (!value) return null;
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data as Row | null;
}

export function hasAnyMeaningful(
  values: ModuleValues,
  fields: string[],
): boolean {
  return fields.some((field) => isMeaningful(values[field]));
}

export async function promoteConfigFields(
  ctx: PromotionContext,
  values: ModuleValues,
  spec: ConfigPromoterSpec,
): Promise<PromotionCounts> {
  const counts: PromotionCounts = {
    created: 0,
    updated: 0,
    noop: 0,
    warnings: [],
  };

  const rows = spec.fields.flatMap((fieldPath) => {
    const value = values[fieldPath];
    if (!isMeaningful(value)) return [];
    const moduleValue = moduleValueId(ctx, fieldPath);
    return [{
      field_path: fieldPath,
      value,
      provenance: sourceProvenance(spec.moduleCode, fieldPath),
      promoted_from_module_value_id: moduleValue,
    }];
  });

  if (rows.length === 0) return counts;

  if (!ctx.dry_run) {
    const { data, error } = await ctx.admin.rpc(
      "promote_facility_launch_scalar_config",
      {
        p_organization_id: ctx.organization_id,
        p_facility_id: ctx.facility_id,
        p_actor_user_id: ctx.actor_user_id,
        p_run_item_id: ctx.run_item_id,
        p_table: spec.table,
        p_rows: rows,
      },
    );
    if (error) {
      throw new Error(`${spec.table} scalar RPC failed: ${error.message}`);
    }
    const rpc = asRecord(data);
    counts.created = asCount(rpc.created);
    counts.updated = asCount(rpc.updated);
    counts.noop = asCount(rpc.noop);
    return counts;
  }

  for (const row of rows) {
    const fieldPath = String(row.field_path);
    const existing = await findConfigRow(ctx, spec.table, fieldPath);
    if (!existing) {
      counts.created += 1;
      continue;
    }

    const updatePayload = {
      value: row.value,
      provenance: row.provenance,
      promoted_from_module_value_id: row.promoted_from_module_value_id,
      updated_by: ctx.actor_user_id,
    };
    if (payloadDiffers(existing, updatePayload)) {
      counts.updated += 1;
    } else {
      counts.noop += 1;
    }
  }

  return counts;
}

export async function promoteCollectionRows(
  ctx: PromotionContext,
  moduleCode: string,
  spec: CollectionPromoteSpec,
): Promise<PromotionCounts> {
  const counts: PromotionCounts = {
    created: 0,
    updated: 0,
    noop: 0,
    warnings: [],
  };
  const moduleValue = moduleValueId(ctx, spec.sourceFieldPath);
  for (const sourceRow of spec.rows) {
    const naturalKey = spec.naturalKey(sourceRow);
    const missingKey = Object.entries(naturalKey).find(([, value]) => !value);
    if (missingKey) {
      counts.warnings.push(
        `${spec.table} ${spec.label(sourceRow)} skipped: missing natural key ${
          missingKey[0]
        }.`,
      );
      continue;
    }

    const payload = {
      organization_id: ctx.organization_id,
      facility_id: ctx.facility_id,
      ...spec.payload(sourceRow),
      provenance: sourceProvenance(moduleCode, spec.sourceFieldPath),
      promoted_from_module_value_id: moduleValue,
      updated_by: ctx.actor_user_id,
    };
    const existing = await findCollectionRow(ctx, spec.table, naturalKey);
    if (!existing) {
      counts.created += 1;
      if (!ctx.dry_run) {
        const { data, error } = await ctx.admin.from(spec.table).insert({
          ...payload,
          created_by: ctx.actor_user_id,
        }).select("id").single();
        if (error || !data?.id) {
          throw new Error(
            `${spec.table} insert failed for ${spec.label(sourceRow)}: ${
              error?.message ?? "missing id"
            }`,
          );
        }
        await insertPromotionLink(ctx, {
          target_table: spec.table,
          target_row_id: String(data.id),
          action: "insert",
          before_value: null,
          after_value: payload,
          module_value_id: moduleValue,
        });
      }
      continue;
    }

    const updatePayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) =>
        !["organization_id", "facility_id"].includes(key)
      ),
    );
    if (payloadDiffers(existing, updatePayload)) {
      counts.updated += 1;
      if (!ctx.dry_run) {
        const { error } = await ctx.admin.from(spec.table).update(updatePayload)
          .eq("id", existing.id);
        if (error) {
          throw new Error(
            `${spec.table} update failed for ${
              spec.label(sourceRow)
            }: ${error.message}`,
          );
        }
        await insertPromotionLink(ctx, {
          target_table: spec.table,
          target_row_id: String(existing.id),
          action: "update",
          before_value: existing,
          after_value: updatePayload,
          module_value_id: moduleValue,
        });
      }
    } else {
      counts.noop += 1;
    }
  }
  return counts;
}

export function configPromotionResult(
  moduleCode: string,
  table: string,
  label: string,
  counts: PromotionCounts,
  extraTables: Array<{ table: string; counts: PromotionCounts }> = [],
  dryRun = false,
): PromotionResult {
  const writes = counts.created + counts.updated +
    extraTables.reduce(
      (sum, item) => sum + item.counts.created + item.counts.updated,
      0,
    );
  const warnings = [
    ...counts.warnings,
    ...extraTables.flatMap((item) => item.counts.warnings),
  ];
  const tables = [
    tableCount(table, counts.created, counts.updated, counts.noop),
    ...extraTables.map((item) =>
      tableCount(
        item.table,
        item.counts.created,
        item.counts.updated,
        item.counts.noop,
      )
    ),
  ];
  const action = dryRun ? "would promote" : "promoted";
  return {
    module_code: moduleCode,
    status: warnings.length > 0 ? "partial" : "promoted",
    summary: writes > 0
      ? `${label} ${action} (${writes} write(s)).`
      : `${label} already current.`,
    tables_touched: compactTables(tables),
    warnings,
    errors: [],
    prerequisites_unmet: [],
  };
}

export function recordArray(values: ModuleValues, fieldPath: string): Row[] {
  const value = values[fieldPath];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

export function stringField(row: Row, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return null;
}
