import type {
  ModulePromoter,
  ModuleValues,
  PromotionContext,
  PromotionResult,
  TablesTouched,
} from "./_types.ts";
import {
  asString,
  compactTables,
  isMeaningful,
  moduleValueId,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";
import {
  configPromotionResult,
  hasAnyMeaningful,
  promoteConfigFields,
  type PromotionCounts,
} from "./_config.ts";

const CONFIG_FIELDS = [
  "billingSystemSource",
  "billingCycle",
  "rateApprovalOwner",
  "postedPrivateRoomRate",
  "postedCompanionRoomRate",
  "medicaidProviderRule",
];

const RATE_SPECS = [
  {
    fieldPath: "postedPrivateRoomRate",
    rateType: "private_room",
    label: "private room",
  },
  {
    fieldPath: "postedCompanionRoomRate",
    rateType: "semi_private_room",
    label: "companion room",
  },
] as const;

const EFFECTIVE_FROM = "2026-01-01";

type Row = Record<string, unknown>;

function dollarsToCents(value: unknown): number | null {
  if (!isMeaningful(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  const raw = asString(value)?.replace(/[$,]/g, "").trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function ratePayload(
  ctx: PromotionContext,
  spec: typeof RATE_SPECS[number],
  amountCents: number,
): Row {
  return {
    organization_id: ctx.organization_id,
    facility_id: ctx.facility_id,
    rate_type: spec.rateType,
    amount_cents: amountCents,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    rate_confirmed: true,
    approved_by: ctx.actor_user_id,
    approved_at: new Date().toISOString(),
    notes:
      `Facility Launch M6 posted ${spec.label} rate from COL Response Log 2026-05-06; resident-specific negotiated rates remain pending current A/R.`,
    created_by: ctx.actor_user_id,
  };
}

function rateDiffers(existing: Row, payload: Row): boolean {
  return [
    "amount_cents",
    "effective_to",
    "rate_confirmed",
    "notes",
  ].some((key) => valuesDiffer(existing[key], payload[key]));
}

function dateKey(value: unknown): string | null {
  return asString(value)?.slice(0, 10) ?? null;
}

function dateRangeOverlaps(
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string | null,
): boolean {
  return leftFrom < (rightTo ?? "9999-12-31") &&
    rightFrom < (leftTo ?? "9999-12-31");
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function findRate(
  ctx: PromotionContext,
  rateType: string,
  effectiveFrom: string,
): Promise<Row | null> {
  const { data, error } = await ctx.admin
    .from("rate_schedule_versions")
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("rate_type", rateType)
    .eq("effective_from", effectiveFrom)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`rate_schedule_versions lookup failed: ${error.message}`);
  }
  return data as Row | null;
}

async function findOverlappingRate(
  ctx: PromotionContext,
  rateType: string,
  effectiveFrom: string,
  effectiveTo: unknown,
  excludeId?: unknown,
): Promise<Row | null> {
  const { data, error } = await ctx.admin
    .from("rate_schedule_versions")
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("rate_type", rateType)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`rate_schedule_versions overlap lookup failed: ${error.message}`);
  }
  const candidateTo = dateKey(effectiveTo);
  return ((data as Row[] | null) ?? []).find((row) => {
    if (excludeId && row.id === excludeId) return false;
    const rowFrom = dateKey(row.effective_from);
    if (!rowFrom) return false;
    return dateRangeOverlaps(rowFrom, dateKey(row.effective_to), effectiveFrom, candidateTo);
  }) ?? null;
}

async function promotePostedRates(
  ctx: PromotionContext,
  values: ModuleValues,
): Promise<PromotionCounts> {
  const counts: PromotionCounts = {
    created: 0,
    updated: 0,
    noop: 0,
    warnings: [],
  };

  const rows: Row[] = RATE_SPECS.flatMap((spec) => {
    const amountCents = dollarsToCents(values[spec.fieldPath]);
    if (amountCents == null) return [];
    return [{
      ...ratePayload(ctx, spec, amountCents),
      promoted_from_module_value_id: moduleValueId(ctx, spec.fieldPath),
    }];
  });

  if (rows.length === 0) return counts;

  if (!ctx.dry_run) {
    const { data, error } = await ctx.admin.rpc(
      "promote_facility_launch_m6_rates",
      {
        p_organization_id: ctx.organization_id,
        p_facility_id: ctx.facility_id,
        p_actor_user_id: ctx.actor_user_id,
        p_run_item_id: ctx.run_item_id,
        p_rows: rows,
      },
    );
    if (error) {
      throw new Error(`rate_schedule_versions rate RPC failed: ${error.message}`);
    }
    const rpc = (typeof data === "object" && data !== null)
      ? data as Row
      : {};
    counts.created = asCount(rpc.created);
    counts.updated = asCount(rpc.updated);
    counts.noop = asCount(rpc.noop);
    return counts;
  }

  for (const row of rows) {
    const rateType = asString(row.rate_type);
    if (!rateType) continue;
    const existing = await findRate(ctx, rateType, EFFECTIVE_FROM);
    const overlapping = await findOverlappingRate(
      ctx,
      rateType,
      EFFECTIVE_FROM,
      row.effective_to,
      existing?.id,
    );
    if (overlapping) {
      throw new Error(
        `rate_schedule_versions overlap failed for ${rateType}: active range ${
          dateKey(overlapping.effective_from) ?? "unknown"
        }..${dateKey(overlapping.effective_to) ?? "open"} overlaps 2026-01-01 candidate`,
      );
    }

    if (!existing) {
      counts.created += 1;
      continue;
    }

    if (rateDiffers(existing, row)) {
      counts.updated += 1;
    } else {
      counts.noop += 1;
    }
  }

  return counts;
}

export const M6_PROMOTER: ModulePromoter = {
  moduleCode: "M6",
  description:
    "Promote resident billing/rate configuration discovered during Facility Launch.",
  prerequisites: [],
  canPromote(values) {
    return {
      ready: hasAnyMeaningful(values, CONFIG_FIELDS),
      missing: [],
    };
  },
  async promote(ctx, values): Promise<PromotionResult> {
    const configCounts = await promoteConfigFields(ctx, values, {
      moduleCode: "M6",
      table: "facility_billing_config",
      fields: CONFIG_FIELDS,
      summaryLabel: "Billing configuration",
    });
    const rateCounts = await promotePostedRates(ctx, values);
    const result = configPromotionResult(
      "M6",
      "facility_billing_config",
      "Billing configuration",
      configCounts,
      [{ table: "rate_schedule_versions", counts: rateCounts }],
      ctx.dry_run,
    );

    const tables: TablesTouched = compactTables([
      tableCount(
        "facility_billing_config",
        configCounts.created,
        configCounts.updated,
        configCounts.noop,
      ),
      tableCount(
        "rate_schedule_versions",
        rateCounts.created,
        rateCounts.updated,
        rateCounts.noop,
      ),
    ]);

    return {
      ...result,
      tables_touched: tables,
    };
  },
};
