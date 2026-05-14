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
  insertPromotionLink,
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

  for (const spec of RATE_SPECS) {
    const amountCents = dollarsToCents(values[spec.fieldPath]);
    if (amountCents == null) continue;

    const payload = ratePayload(ctx, spec, amountCents);
    const moduleValue = moduleValueId(ctx, spec.fieldPath);
    const existing = await findRate(ctx, spec.rateType, EFFECTIVE_FROM);

    if (!existing) {
      counts.created += 1;
      if (!ctx.dry_run) {
        const { data, error } = await ctx.admin.from("rate_schedule_versions")
          .insert(payload)
          .select("id")
          .single();
        if (error || !data?.id) {
          throw new Error(
            `rate_schedule_versions insert failed for ${spec.rateType}: ${
              error?.message ?? "missing id"
            }`,
          );
        }
        await insertPromotionLink(ctx, {
          target_table: "rate_schedule_versions",
          target_row_id: String(data.id),
          action: "insert",
          before_value: null,
          after_value: payload,
          module_value_id: moduleValue,
        });
      }
      continue;
    }

    const updatePayload = {
      amount_cents: payload.amount_cents,
      effective_to: payload.effective_to,
      rate_confirmed: payload.rate_confirmed,
      approved_by: payload.approved_by,
      approved_at: payload.approved_at,
      notes: payload.notes,
    };
    if (rateDiffers(existing, payload)) {
      counts.updated += 1;
      if (!ctx.dry_run) {
        const { error } = await ctx.admin.from("rate_schedule_versions")
          .update(updatePayload)
          .eq("id", existing.id);
        if (error) {
          throw new Error(
            `rate_schedule_versions update failed for ${spec.rateType}: ${error.message}`,
          );
        }
        await insertPromotionLink(ctx, {
          target_table: "rate_schedule_versions",
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
