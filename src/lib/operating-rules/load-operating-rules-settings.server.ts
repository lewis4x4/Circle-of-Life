import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerAuthContext } from "@/lib/auth/server-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/server";

import { loadOperatingRule, OPERATING_RULE_KEYS, type OperatingRuleKey } from "./operating-rules";
import {
  facilityOverridesInForce,
  OPERATING_RULE_COPY,
  type OperatingRuleFacility,
  type OperatingRuleHistoryRow,
  type OperatingRulesSettingsLoad,
} from "./operating-rules-settings";

type Row = {
  id: string;
  rule_key: OperatingRuleKey;
  facility_id: string | null;
  value: unknown;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

/**
 * Operating rules for Settings → Threshold targets: the organization rule and
 * every facility override the caller can read. Owners and org admins may set
 * either; a facility administrator may set a rule for the facilities they can
 * access (the `operating_rule_record` command and the 491 policy decide).
 */
export async function loadOperatingRulesSettings(): Promise<OperatingRulesSettingsLoad> {
  const auth = await getServerAuthContext();
  const todayIso = todayFacilityDateIso();
  const role = auth.ok ? auth.ctx.appRole : null;
  const canEditOrganization = role === "owner" || role === "org_admin";
  const canEdit = canEditOrganization || role === "facility_admin";
  const supabase = (await createClient()) as unknown as SupabaseClient;

  const [rowsRes, facilitiesRes, current] = await Promise.all([
    supabase
      .from("operating_rules" as never)
      .select("id, rule_key, facility_id, value, effective_from, change_reason, created_at")
      .order("effective_from" as never, { ascending: false })
      .limit(500) as unknown as Promise<{ data: Row[] | null; error: { message: string } | null }>,
    canEdit
      ? (supabase
          .from("facilities")
          .select("id, name")
          .is("deleted_at", null)
          .order("name", { ascending: true }) as unknown as Promise<{
          data: OperatingRuleFacility[] | null;
          error: { message: string } | null;
        }>)
      : Promise.resolve({ data: [] as OperatingRuleFacility[], error: null }),
    Promise.all(OPERATING_RULE_KEYS.map((key) => loadOperatingRule(supabase, { key, asOf: todayIso }))),
  ]);

  const facilities: OperatingRuleFacility[] = (facilitiesRes.data ?? []).map((f) => ({ id: f.id, name: f.name }));

  const rows: OperatingRuleHistoryRow[] = (rowsRes.data ?? []).map((r) => ({
    id: r.id,
    ruleKey: r.rule_key,
    facilityId: r.facility_id,
    value: r.value,
    effectiveFrom: r.effective_from,
    changeReason: r.change_reason,
    createdAt: r.created_at,
  }));

  return {
    canEdit,
    canEditOrganization,
    facilities,
    organizationId: auth.ok ? auth.ctx.organizationId : null,
    userId: auth.ok ? auth.ctx.userId : null,
    todayIso,
    loadError:
      rowsRes.error || facilitiesRes.error ? "Operating rules could not be loaded." : null,
    rules: OPERATING_RULE_KEYS.map((key, index) => {
      const history = rows.filter((r) => r.ruleKey === key);
      return {
        key,
        ...OPERATING_RULE_COPY[key],
        current: current[index] ? current[index]!.value : undefined,
        facilityOverrides: facilityOverridesInForce(history, facilities, todayIso),
        scheduled: history.filter((r) => r.effectiveFrom > todayIso).reverse(),
        history,
      };
    }),
  };
}
