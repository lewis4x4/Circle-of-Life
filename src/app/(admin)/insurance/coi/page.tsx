"use client";

import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  INSURANCE_COI_LIST_SELECT,
  INSURANCE_HUB_LIST_LIMIT,
} from "@/lib/admin/hub-list-limits";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["certificates_of_insurance"]["Row"];

export default function InsuranceCoiPage() {
  const supabase = createClient();
  // Identity comes from the app-wide auth provider instead of a per-page
  // duplicate auth/profile lookup.
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    // Stable key: [feature, scope, ...scoping ids]. The organizationId keeps
    // the cache correct across org switches; the query only runs once it's known.
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

  // Spinner while either auth resolves or the (enabled) query is in flight,
  // matching the page's previous single loading state.
  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : error
        ? error.message
        : null;

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Certificates of insurance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Third-party COIs (vendors, landlords, lenders) with expiry ordering.
        </p>
      </div>
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certificates</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Holder</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Carrier</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.holder_name}</td>
                  <td className="py-2 pr-4">{r.holder_type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{r.carrier_name}</td>
                  <td className="py-2 pr-4">{r.expiration_date}</td>
                  <td className="py-2 tabular-nums">{formatUsdFromCents(r.aggregate_limit_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No certificates on file.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
