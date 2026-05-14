import type {
  ModuleValues,
  PromotionContext,
  TablesTouched,
} from "./_types.ts";

export type JsonRecord = Record<string, unknown>;

export type WriteAction = "insert" | "update" | "noop";

export type LinkInput = {
  target_table: string;
  target_row_id: string;
  action: WriteAction;
  before_value: unknown;
  after_value: unknown;
  module_value_id?: string | null;
};

export type TableCount = {
  table: string;
  rows_created: number;
  rows_updated: number;
  rows_noop?: number;
};

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function isEmptyOperationalValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

export function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return null;
}

export function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseDateOrNull(
  value: unknown,
): { date: string | null; warning?: string } {
  const raw = asString(value);
  if (!raw) return { date: null };
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
    !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
  ) {
    return { date: raw };
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return { date: parsed.toISOString().slice(0, 10) };
  }
  return { date: null, warning: `Could not parse date value '${raw}'.` };
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableJson(entryValue)}`
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function valuesDiffer(left: unknown, right: unknown): boolean {
  if (left instanceof Date) left = left.toISOString();
  if (right instanceof Date) right = right.toISOString();
  if (typeof left === "string" && typeof right === "string") {
    return left.trim() !== right.trim();
  }
  return stableJson(left ?? null) !== stableJson(right ?? null);
}

export function moduleValueId(
  ctx: PromotionContext,
  fieldPath: string,
): string | null {
  return ctx.module_value_ids_by_path?.[fieldPath] ?? null;
}

export function tableCount(
  table: string,
  rows_created = 0,
  rows_updated = 0,
  rows_noop = 0,
): TableCount {
  return { table, rows_created, rows_updated, rows_noop };
}

export function compactTables(tables: TableCount[]): TablesTouched {
  return tables.map((table) => ({
    table: table.table,
    rows_created: table.rows_created,
    rows_updated: table.rows_updated,
    ...(table.rows_noop ? { rows_noop: table.rows_noop } : {}),
  })) as TablesTouched;
}

export function mergeMetadata(
  existing: unknown,
  patch: JsonRecord,
): JsonRecord {
  return { ...asRecord(existing), ...patch };
}

export function pickMeaningful(
  values: ModuleValues,
  keys: string[],
): JsonRecord {
  const out: JsonRecord = {};
  for (const key of keys) {
    const value = values[key];
    if (isMeaningful(value)) out[key] = value;
  }
  return out;
}

export function normalizeUnitName(room: JsonRecord): string {
  const wing = asString(room.wing);
  const floor = asString(room.floor);
  const normalizedWing = (wing ?? "").toLowerCase();
  if (
    !wing || normalizedWing === "none" ||
    normalizedWing.includes("single floor")
  ) return "Main";
  if (floor) return `${wing} Floor ${floor}`;
  return wing;
}

export function normalizeFloor(value: unknown): number {
  const parsed = asInteger(value);
  return parsed && parsed > 0 ? parsed : 1;
}

export function roomTypeFromUnitType(
  value: unknown,
  bedCount: number,
): "private" | "semi_private" | "shared" {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized.includes("companion") || normalized.includes("double") ||
    bedCount === 2
  ) return "semi_private";
  if (bedCount > 2) return "shared";
  return "private";
}

export function bedLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export async function insertPromotionLink(
  ctx: PromotionContext,
  input: LinkInput,
): Promise<void> {
  if (ctx.dry_run || !ctx.run_item_id) return;
  // Re-runs should not create new ledger rows for no-op operational rows.
  if (input.action === "noop") return;
  const { error } = await ctx.admin.from("facility_launch_promotion_run_links")
    .insert({
      run_item_id: ctx.run_item_id,
      organization_id: ctx.organization_id,
      facility_id: ctx.facility_id,
      module_value_id: input.module_value_id ?? null,
      target_table: input.target_table,
      target_row_id: input.target_row_id,
      action: input.action,
      before_value: input.before_value ?? null,
      after_value: input.after_value ?? null,
    });
  if (error) throw new Error(`Promotion link insert failed: ${error.message}`);
}

export function partialSafetyWarning(
  column: string,
  existing: unknown,
  intake: unknown,
): string {
  return `${column} has existing value '${String(existing)}'; intake value '${
    String(intake)
  }' was skipped. Set force_overwrite=true to override.`;
}
