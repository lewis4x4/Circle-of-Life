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
  INSURANCE_CLAIM_DETAIL_AUTH_LOADING_COPY,
  INSURANCE_CLAIM_DETAIL_LOADING_COPY,
  INSURANCE_CLAIM_DETAIL_SCOPE_ET_COPY,
  formatInsuranceClaimDateOfLoss,
  formatInsuranceClaimDetailReportedAt,
  resolveInsuranceClaimDetailLoadErrorMessage,
} from "@/lib/insurance/insurance-claim-detail-display-copy";
import {
  resolveInsuranceClaimDetailFetchErrorBannerMessage,
  resolveInsuranceClaimDetailOrganizationGapMessage,
} from "@/lib/insurance/insurance-claim-detail-page-state";
import { formatInsuranceClaimNumber } from "@/lib/insurance/claims-display-copy";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Claim = Database["public"]["Tables"]["insurance_claims"]["Row"];
type Activity = Database["public"]["Tables"]["claim_activities"]["Row"];

export default function InsuranceClaimDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const organizationGapMessage = resolveInsuranceClaimDetailOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: claim !== null,
  });
  const fetchErrorBannerMessage = resolveInsuranceClaimDetailFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (!id || authLoading) {
      return;
    }

    if (!organizationId) {
      setClaim(null);
      setActivities([]);
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);

    const { data: c, error: cErr } = await supabase
      .from("insurance_claims")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (cErr || !c) {
      setClaim(null);
      setActivities([]);
      setFetchError(
        resolveInsuranceClaimDetailLoadErrorMessage({
          queryFailed: Boolean(cErr),
          claimFound: Boolean(c),
        }),
      );
      setFetching(false);
      return;
    }

    setClaim(c as Claim);

    const { data: acts, error: actsErr } = await supabase
      .from("claim_activities")
      .select("*")
      .eq("insurance_claim_id", id)
      .is("deleted_at", null)
      .order("activity_date", { ascending: false });

    if (actsErr) {
      setActivities([]);
      setFetchError(
        resolveInsuranceClaimDetailLoadErrorMessage({
          queryFailed: true,
          claimFound: true,
        }),
      );
      setFetching(false);
      return;
    }

    setActivities((acts ?? []) as Activity[]);
    setFetching(false);
  }, [supabase, id, organizationId, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-muted-foreground" role="status">
          {authLoading ? INSURANCE_CLAIM_DETAIL_AUTH_LOADING_COPY : INSURANCE_CLAIM_DETAIL_LOADING_COPY}
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
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/claims">
          Back to claims
        </Link>
      </div>
    );
  }

  if (fetchErrorBannerMessage || !claim) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        {fetchErrorBannerMessage ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {fetchErrorBannerMessage}
          </p>
        ) : null}
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/claims">
          Back to claims
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <RecordDetailHeader
        title="Claim"
        subtitle={`${formatInsuranceClaimNumber(claim.claim_number)} · ${claim.status.replace(/_/g, " ")}`}
        backLink={{ label: "Back to claims", href: "/admin/insurance/claims" }}
      />

      <p className="text-sm text-muted-foreground">{INSURANCE_CLAIM_DETAIL_SCOPE_ET_COPY}</p>

      <RecordDetailSection
        title="Summary"
        description="Reserves and payments in USD (integer cents in database)."
      >
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Date of loss (ET):</span>{" "}
            {formatInsuranceClaimDateOfLoss(claim.date_of_loss)}
          </p>
          <p>
            <span className="text-muted-foreground">Reported (ET):</span>{" "}
            {formatInsuranceClaimDetailReportedAt(claim.reported_at)}
          </p>
          <p>
            <span className="text-muted-foreground">Reserve:</span>{" "}
            <span className="tabular-nums">{formatUsdFromCents(claim.reserve_cents)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Paid:</span>{" "}
            <span className="tabular-nums">{formatUsdFromCents(claim.paid_cents)}</span>
          </p>
          {claim.incident_id && (
            <p className="md:col-span-2">
              <span className="text-muted-foreground">Incident:</span>{" "}
              <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/incidents/${claim.incident_id}`}>
                Open incident
              </Link>
            </p>
          )}
          {claim.description && (
            <p className="md:col-span-2">
              <span className="text-muted-foreground">Description:</span> {claim.description}
            </p>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Activities"
        description="Notes from adjusters and internal staff."
      >
        <div className="overflow-x-auto">
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities logged.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 align-top">{a.activity_date}</td>
                    <td className="py-2 pr-4 align-top">{a.activity_type}</td>
                    <td className="py-2 align-top">{a.description}</td>
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
