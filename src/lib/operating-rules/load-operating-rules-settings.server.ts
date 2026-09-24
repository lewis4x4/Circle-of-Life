import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerAuthContext } from "@/lib/auth/server-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/server";

import { loadOperatingRule, OPERATING_RULE_KEYS, type OperatingRuleKey } from "./operating-rules";
import {
  OPERATING_RULE_COPY,
  type OperatingRuleHistoryRow,
  type OperatingRulesSettingsLoad,
} from "./operating-rules-settings";

type Row = {
  id: string;
  rule_key: OperatingRuleKey;
  value: unknown;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

/** Organization-wide operating rules for Settings → Threshold targets. */
export async function loadOperatingRulesSettings(): Promise<OperatingRulesSettingsLoad> {
  const auth = await getServerAuthContext();
  const todayIso = todayFacilityDateIso();
  const canEdit = auth.ok && (auth.ctx.appRole === "owner" || auth.ctx.appRole === "org_admin");
  const supabase = (await createClient()) as unknown as SupabaseClient;

  const rowsRes = (await supabase
    .from("operating_rules" as never)
    .select("id, rule_key, value, effective_from, change_reason, created_at")
    .is("facility_id" as never, null as never)
    .order("effective_from" as never, { ascending: false })
    .limit(200)) as unknown as { data: Row[] | null; error: { message: string } | null };

  const current = await Promise.all(
    OPERATING_RULE_KEYS.map((key) => loadOperatingRule(supabase, { key, asOf: todayIso })),
  );

  const rows: OperatingRuleHistoryRow[] = (rowsRes.data ?? []).map((r) => ({
    id: r.id,
    ruleKey: r.rule_key,
    value: r.value,
    effectiveFrom: r.effective_from,
    changeReason: r.change_reason,
    createdAt: r.created_at,
  }));

  return {
    canEdit,
    organizationId: auth.ok ? auth.ctx.organizationId : null,
    userId: auth.ok ? auth.ctx.userId : null,
    todayIso,
    loadError: rowsRes.error ? "Operating rules could not be loaded." : null,
    rules: OPERATING_RULE_KEYS.map((key, index) => {
      const history = rows.filter((r) => r.ruleKey === key);
      return {
        key,
        ...OPERATING_RULE_COPY[key],
        current: current[index] ? current[index]!.value : undefined,
        scheduled: history.filter((r) => r.effectiveFrom > todayIso).reverse(),
        history,
      };
    }),
  };
}
