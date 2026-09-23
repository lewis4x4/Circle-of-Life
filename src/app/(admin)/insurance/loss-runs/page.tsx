"use client";

import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  INSURANCE_LOSS_RUNS_LOADING_PROFILE_COPY,
  resolveInsuranceLossRunsFetchErrorBannerMessage,
  resolveInsuranceLossRunsOrganizationGapMessage,
} from "@/lib/insurance/loss-runs-page-state";
import {
  INSURANCE_HUB_LIST_LIMIT,
  INSURANCE_LOSS_RUNS_LIST_SELECT,
} from "@/lib/admin/hub-list-limits";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["loss_runs"]["Row"];

export { INSURANCE_LOSS_RUNS_LOADING_PROFILE_COPY };

export default function InsuranceLossRunsPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["insurance", "loss-runs", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("loss_runs")
        .select(INSURANCE_LOSS_RUNS_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("period_end", { ascending: false })
        .limit(INSURANCE_HUB_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const loading = authLoading || isPending;
  const organizationGapMessage = resolveInsuranceLossRunsOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveInsuranceLossRunsFetchErrorBannerMessage({
    authLoading,
    fetchError: error?.message ?? null,
  });

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Loss runs</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Generated loss summaries by entity and period.
        </p>
      </div>
      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {INSURANCE_LOSS_RUNS_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {fetchErrorBannerMessage}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Claims</th>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 font-medium">Reserve</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">
                    {r.period_start} – {r.period_end}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{r.total_claims_count}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(Number(r.total_paid_cents))}</td>
                  <td className="py-2 tabular-nums">{formatUsdFromCents(Number(r.total_reserve_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && organizationId ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No loss runs generated yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
