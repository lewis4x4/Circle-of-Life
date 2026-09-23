"use client";

import { useQuery } from "@tanstack/react-query";

import { CoverageLapseBanner } from "@/components/insurance/coverage-lapse-banner";
import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { workersCompReturnToWorkDateCopy } from "@/lib/insurance/workers-comp-copy";
import {
  INSURANCE_WORKERS_COMP_LOADING_PROFILE_COPY,
  resolveInsuranceWorkersCompFetchErrorBannerMessage,
  resolveInsuranceWorkersCompOrganizationGapMessage,
} from "@/lib/insurance/workers-comp-page-state";
import {
  INSURANCE_HUB_LIST_LIMIT,
  INSURANCE_WORKERS_COMP_LIST_SELECT,
} from "@/lib/admin/hub-list-limits";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["workers_comp_claims"]["Row"];

export { INSURANCE_WORKERS_COMP_LOADING_PROFILE_COPY };

export default function InsuranceWorkersCompPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["insurance", "workers-comp", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("workers_comp_claims")
        .select(INSURANCE_WORKERS_COMP_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("injury_date", { ascending: false })
        .limit(INSURANCE_HUB_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const loading = authLoading || isPending;
  const organizationGapMessage = resolveInsuranceWorkersCompOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveInsuranceWorkersCompFetchErrorBannerMessage({
    authLoading,
    fetchError: error?.message ?? null,
  });

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <CoverageLapseBanner policyType="workers_comp" />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Workers’ compensation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Workers’ compensation claims for this facility. OSHA 300 log detail is not kept here.
        </p>
      </div>
      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {INSURANCE_WORKERS_COMP_LOADING_PROFILE_COPY}
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
          <CardTitle className="text-base">Claims</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Injury date</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Reserve</th>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 font-medium">Return to work</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.injury_date}</td>
                  <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.reserve_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.paid_cents)}</td>
                  <td className="py-2">{workersCompReturnToWorkDateCopy(r.return_to_work_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && organizationId ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No workers’ comp claims yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
