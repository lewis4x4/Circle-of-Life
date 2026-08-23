"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import {
  isPayrollNewSubmitBlocked,
  resolvePayrollNewFetchErrorBannerMessage,
  resolvePayrollNewOrganizationGapMessage,
  resolvePayrollNewSubmitButtonLabel,
} from "@/lib/payroll/payroll-new-page-state";
import { PAYROLL_NEW_LOADING_PROFILE_COPY } from "@/lib/payroll/payroll-new-display-copy";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminPayrollNewBatchPage() {
  const supabase = createClient();
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [provider, setProvider] = useState("generic");
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const organizationGapMessage = resolvePayrollNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolvePayrollNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });

  const submitBlocked = isPayrollNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    userId: user?.id,
    facilityReady,
    periodStart,
    periodEnd,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const { error: insErr } = await supabase.from("payroll_export_batches").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        period_start: periodStart,
        period_end: periodEnd,
        provider: provider.trim() || "generic",
        status: "draft",
        created_by: user.id,
      });
      if (insErr) throw new Error(insErr.message);
      router.push("/admin/payroll");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not create batch.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New payroll batch
        </h1>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {PAYROLL_NEW_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {!facilityReady && !authLoading ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      ) : null}

      {fetchErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {fetchErrorBannerMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Draft export batch</CardTitle>
          <CardDescription>
            Owner, org admin, or facility admin only. Add mileage lines from approved trips on the batch detail page; time-record lines remain Enhanced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ps">Period start (ET)</Label>
                <Input
                  id="ps"
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  aria-label="Period start (Eastern Time)"
                  disabled={Boolean(organizationGapMessage) || authLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pe">Period end (ET)</Label>
                <Input
                  id="pe"
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  aria-label="Period end (Eastern Time)"
                  disabled={Boolean(organizationGapMessage) || authLoading}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov">Provider key</Label>
              <Input
                id="prov"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="generic"
                disabled={Boolean(organizationGapMessage) || authLoading}
              />
            </div>
            <Button type="submit" disabled={submitBlocked}>
              {resolvePayrollNewSubmitButtonLabel({ saving, authLoading })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
