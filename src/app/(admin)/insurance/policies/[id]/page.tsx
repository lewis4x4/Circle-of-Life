"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InsuranceHubNav } from "../../insurance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  INSURANCE_POLICY_DETAIL_AUTH_LOADING_COPY,
  INSURANCE_POLICY_DETAIL_LOADING_COPY,
  INSURANCE_POLICY_DETAIL_SCOPE_ET_COPY,
  formatInsuranceClaimDateOfLoss,
  formatInsurancePolicyDetailEffectiveDate,
  formatInsurancePolicyDetailPeriodDate,
  formatInsurancePolicyExpirationDate,
  formatInsuranceRenewalTargetDate,
  resolveInsurancePolicyDetailLoadErrorMessage,
} from "@/lib/insurance/insurance-policy-detail-display-copy";
import {
  resolveInsurancePolicyDetailFetchErrorBannerMessage,
  resolveInsurancePolicyDetailOrganizationGapMessage,
} from "@/lib/insurance/insurance-policy-detail-page-state";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Policy = Database["public"]["Tables"]["insurance_policies"]["Row"];
type Renewal = Database["public"]["Tables"]["insurance_renewals"]["Row"];
type Claim = Database["public"]["Tables"]["insurance_claims"]["Row"];
type Alloc = Database["public"]["Tables"]["premium_allocations"]["Row"];

export default function InsurancePolicyDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [entityName, setEntityName] = useState<string>("");
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const organizationGapMessage = resolveInsurancePolicyDetailOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: policy !== null,
  });
  const fetchErrorBannerMessage = resolveInsurancePolicyDetailFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (!id || authLoading) {
      return;
    }

    if (!organizationId) {
      setPolicy(null);
      setEntityName("");
      setRenewals([]);
      setClaims([]);
      setAllocs([]);
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);

    const { data: pol, error: pErr } = await supabase
      .from("insurance_policies")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (pErr || !pol) {
      setPolicy(null);
      setEntityName("");
      setRenewals([]);
      setClaims([]);
      setAllocs([]);
      setFetchError(
        resolveInsurancePolicyDetailLoadErrorMessage({
          queryFailed: Boolean(pErr),
          policyFound: Boolean(pol),
        }),
      );
      setFetching(false);
      return;
    }

    const p = pol as Policy;
    setPolicy(p);

    const { data: ent, error: entErr } = await supabase
      .from("entities")
      .select("name")
      .eq("id", p.entity_id)
      .maybeSingle();

    if (entErr) {
      setEntityName("");
      setRenewals([]);
      setClaims([]);
      setAllocs([]);
      setFetchError(
        resolveInsurancePolicyDetailLoadErrorMessage({
          queryFailed: true,
          policyFound: true,
        }),
      );
      setFetching(false);
      return;
    }

    setEntityName((ent as { name: string } | null)?.name ?? p.entity_id);

    const [{ data: r, error: rErr }, { data: c, error: cErr }, { data: a, error: aErr }] = await Promise.all([
      supabase
        .from("insurance_renewals")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("target_effective_date", { ascending: false }),
      supabase
        .from("insurance_claims")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("date_of_loss", { ascending: false }),
      supabase
        .from("premium_allocations")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("period_end", { ascending: false }),
    ]);

    const subErr = rErr ?? cErr ?? aErr;
    if (subErr) {
      setRenewals([]);
      setClaims([]);
      setAllocs([]);
      setFetchError(
        resolveInsurancePolicyDetailLoadErrorMessage({
          queryFailed: true,
          policyFound: true,
        }),
      );
      setFetching(false);
      return;
    }

    setRenewals((r ?? []) as Renewal[]);
    setClaims((c ?? []) as Claim[]);
    setAllocs((a ?? []) as Alloc[]);
    setFetching(false);
  }, [supabase, id, organizationId, authLoading]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-muted-foreground" role="status">
          {authLoading ? INSURANCE_POLICY_DETAIL_AUTH_LOADING_COPY : INSURANCE_POLICY_DETAIL_LOADING_COPY}
        </p>
      </div>
    );
  }

  if (organizationGapMessage) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/policies">
          Back to policies
        </Link>
      </div>
    );
  }

  if (fetchErrorBannerMessage || !policy) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        {fetchErrorBannerMessage ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {fetchErrorBannerMessage}
          </p>
        ) : null}
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/policies">
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <RecordDetailHeader
        title={policy.carrier_name}
        subtitle={`${entityName} · ${policy.policy_type.replace(/_/g, " ")} · ${policy.policy_number}`}
        backLink={{ label: "Back to policies", href: "/admin/insurance/policies" }}
      />

      <p className="text-sm text-muted-foreground">{INSURANCE_POLICY_DETAIL_SCOPE_ET_COPY}</p>

      <RecordDetailSection
        title="Coverage"
        description={`Effective ${formatInsurancePolicyDetailEffectiveDate(policy.effective_date)} through ${formatInsurancePolicyExpirationDate(policy.expiration_date)} (ET)`}
      >
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Status:</span> {policy.status.replace(/_/g, " ")}
          </p>
          <p>
            <span className="text-muted-foreground">Premium:</span>{" "}
            <span className="tabular-nums">{formatUsdFromCents(policy.premium_cents)}</span>
          </p>
          {policy.broker_name && (
            <p>
              <span className="text-muted-foreground">Broker:</span> {policy.broker_name}
            </p>
          )}
          {policy.notes && (
            <p className="md:col-span-2">
              <span className="text-muted-foreground">Notes:</span> {policy.notes}
            </p>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Renewals"
        description="Milestones and premiums for this policy."
      >
        <div className="overflow-x-auto">
          {renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No renewals recorded.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Target effective (ET)</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Quoted</th>
                  <th className="py-2 font-medium">Bound</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{formatInsuranceRenewalTargetDate(r.target_effective_date)}</td>
                    <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.quoted_premium_cents)}</td>
                    <td className="py-2 tabular-nums">{formatUsdFromCents(r.bound_premium_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Premium allocations"
        description="Facility splits for internal reporting."
      >
        <div className="overflow-x-auto">
          {allocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No allocations.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Period (ET)</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      {formatInsurancePolicyDetailPeriodDate(a.period_start)} –{" "}
                      {formatInsurancePolicyDetailPeriodDate(a.period_end)}
                    </td>
                    <td className="py-2 pr-4">{a.allocation_method.replace(/_/g, " ")}</td>
                    <td className="py-2 tabular-nums">{formatUsdFromCents(a.allocated_premium_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Linked claims"
        description="Corporate GL claims on this policy."
      >
        <div className="overflow-x-auto">
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked claims.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Loss date (ET)</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Reserve</th>
                  <th className="py-2 pr-4 font-medium">Paid</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{formatInsuranceClaimDateOfLoss(c.date_of_loss)}</td>
                    <td className="py-2 pr-4">{c.status.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(c.reserve_cents)}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(c.paid_cents)}</td>
                    <td className="py-2">
                      <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/insurance/claims/${c.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </RecordDetailSection>
    </div>
  );
}
