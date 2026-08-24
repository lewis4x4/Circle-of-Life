"use client";

import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  INSURANCE_COI_LIST_SELECT,
  INSURANCE_HUB_LIST_LIMIT,
} from "@/lib/admin/hub-list-limits";
import {
  formatInsuranceCoiExpirationDate,
  INSURANCE_COI_ORG_SCOPE_COPY,
} from "@/lib/insurance/coi-display-copy";
import {
  INSURANCE_COI_LOADING_PROFILE_COPY,
  resolveInsuranceCoiFetchErrorBannerMessage,
  resolveInsuranceCoiOrganizationGapMessage,
} from "@/lib/insurance/coi-page-state";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["certificates_of_insurance"]["Row"];

export { INSURANCE_COI_LOADING_PROFILE_COPY };

export default function InsuranceCoiPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["insurance", "coi", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("certificates_of_insurance")
        .select(INSURANCE_COI_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("expiration_date", { ascending: true })
        .limit(INSURANCE_HUB_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const loading = authLoading || isPending;
  const organizationGapMessage = resolveInsuranceCoiOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const loadError = resolveInsuranceCoiFetchErrorBannerMessage({
    authLoading,
    fetchError: error?.message ?? null,
  });

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Certificates of insurance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Third-party COIs (vendors, landlords, lenders) with expiry ordering.
        </p>
        {organizationId ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{INSURANCE_COI_ORG_SCOPE_COPY}</p>
        ) : null}
      </div>

      {authLoading ? (
        <p className="text-sm text-slate-600 dark:text-slate-400" role="status" aria-live="polite">
          {INSURANCE_COI_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-slate-300 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
          <CardContent className="p-4 text-sm text-slate-600 dark:text-slate-400">
            {organizationGapMessage}
          </CardContent>
        </Card>
      ) : null}

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certificates</CardTitle>
          <CardDescription>{loading ? INSURANCE_COI_LOADING_PROFILE_COPY : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Holder</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Carrier</th>
                <th className="py-2 pr-4 font-medium">Expires (ET)</th>
                <th className="py-2 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.holder_name}</td>
                  <td className="py-2 pr-4">{r.holder_type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{r.carrier_name}</td>
                  <td className="py-2 pr-4">{formatInsuranceCoiExpirationDate(r.expiration_date)}</td>
                  <td className="py-2 tabular-nums">{formatUsdFromCents(r.aggregate_limit_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && organizationId ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No certificates on file.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
