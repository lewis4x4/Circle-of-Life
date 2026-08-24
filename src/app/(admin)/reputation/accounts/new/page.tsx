"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  REPUTATION_ACCOUNT_NEW_LOADING_PROFILE_COPY,
  REPUTATION_ACCOUNT_NEW_ORGANIZATION_SCOPE_COPY,
} from "@/lib/reputation/reputation-account-new-display-copy";
import {
  isReputationAccountNewSubmitBlocked,
  resolveReputationAccountNewFetchErrorBannerMessage,
  resolveReputationAccountNewOrganizationGapMessage,
  resolveReputationAccountNewSubmitButtonLabel,
} from "@/lib/reputation/reputation-account-new-page-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Platform = Database["public"]["Enums"]["reputation_platform"];

const PLATFORMS: Platform[] = ["google_business", "yelp", "facebook", "caring_com", "other"];

export default function AdminReputationAccountNewPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<Platform>("other");
  const [externalPlaceId, setExternalPlaceId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const organizationGapMessage = resolveReputationAccountNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolveReputationAccountNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const submitBlocked = isReputationAccountNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    userId: user?.id ?? null,
    facilityReady,
    label,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const { error: insErr } = await supabase.from("reputation_accounts").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        label: label.trim(),
        platform,
        external_place_id: externalPlaceId.trim() || null,
        notes: notes.trim() || null,
        is_active: true,
        created_by: user.id,
      });
      if (insErr) throw new Error(insErr.message);
      router.push("/admin/reputation");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Add listing
        </h1>
        <Link href="/admin/reputation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {REPUTATION_ACCOUNT_NEW_LOADING_PROFILE_COPY}
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
          <CardTitle className="text-lg">Review surface</CardTitle>
          <CardDescription>
            Store a label and optional external id for hand-off to Enhanced sync jobs.{" "}
            {REPUTATION_ACCOUNT_NEW_ORGANIZATION_SCOPE_COPY}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Main campus Google"
                disabled={Boolean(organizationGapMessage) || authLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plat">Platform</Label>
              <select
                id="plat"
                className={selectClass}
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                disabled={Boolean(organizationGapMessage) || authLoading}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ext">External place / listing ID</Label>
              <Input
                id="ext"
                value={externalPlaceId}
                onChange={(e) => setExternalPlaceId(e.target.value)}
                className="font-mono text-sm"
                disabled={Boolean(organizationGapMessage) || authLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={Boolean(organizationGapMessage) || authLoading}
              />
            </div>
            <Button type="submit" disabled={submitBlocked}>
              {resolveReputationAccountNewSubmitButtonLabel({
                saving,
                authLoading,
                organizationId,
                userId: user?.id ?? null,
                facilityReady,
                label,
              })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
