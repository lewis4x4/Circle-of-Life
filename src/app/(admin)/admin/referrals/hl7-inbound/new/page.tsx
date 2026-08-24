"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ReferralsHubNav } from "../../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { HL7_INBOUND_NEW_LOADING_PROFILE_COPY } from "@/lib/referrals/hl7-inbound-new-display-copy";
import {
  isHl7InboundNewSubmitBlocked,
  resolveHl7InboundNewFetchErrorBannerMessage,
  resolveHl7InboundNewOrganizationGapMessage,
  resolveHl7InboundNewSubmitButtonLabel,
} from "@/lib/referrals/hl7-inbound-new-page-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminReferralsHl7InboundNewPage() {
  const supabase = createClient();
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [rawMessage, setRawMessage] = useState("");
  const [messageControlId, setMessageControlId] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const organizationGapMessage = resolveHl7InboundNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolveHl7InboundNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });

  const submitBlocked = isHl7InboundNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    userId: user?.id,
    facilityReady,
    rawMessage,
  });

  const formDisabled = authLoading || Boolean(organizationGapMessage) || !user;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const { error: insErr } = await supabase.from("referral_hl7_inbound").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        raw_message: rawMessage.trim(),
        message_control_id: messageControlId.trim() || null,
        trigger_event: triggerEvent.trim() || null,
        status: "pending",
        created_by: user.id,
      });
      if (insErr) throw new Error(insErr.message);
      router.push("/admin/referrals/hl7-inbound");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const taClass = cn(
    "min-h-[180px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Add Referral
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Manually add an electronic referral. Paste the referral data below, or enter key details for tracking.
        </p>
      </div>

      <ReferralsHubNav />

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {HL7_INBOUND_NEW_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {!facilityReady && !authLoading ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header before adding a referral.
        </p>
      ) : null}

      {fetchErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {fetchErrorBannerMessage}
        </p>
      ) : null}

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg">Message</CardTitle>
          <CardDescription>Optional reference ID avoids duplicates when the same referral is received twice.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="raw">Referral Data</Label>
              <textarea
                id="raw"
                required
                className={taClass}
                value={rawMessage}
                onChange={(e) => setRawMessage(e.target.value)}
                placeholder="MSH|^~\\&|..."
                spellCheck={false}
                disabled={formDisabled}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="msh10">Reference ID</Label>
                <Input
                  id="msh10"
                  value={messageControlId}
                  onChange={(e) => setMessageControlId(e.target.value)}
                  className="font-mono text-sm"
                  disabled={formDisabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trg">Referral Type</Label>
                <Input
                  id="trg"
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  disabled={formDisabled}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitBlocked}>
                {resolveHl7InboundNewSubmitButtonLabel({ saving, authLoading })}
              </Button>
              <Link href="/admin/referrals/hl7-inbound" className={cn(buttonVariants({ variant: "outline" }))}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
