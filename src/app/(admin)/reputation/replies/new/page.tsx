"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  REPUTATION_REPLY_NEW_LOADING_PROFILE_COPY,
  REPUTATION_REPLY_NEW_ORGANIZATION_SCOPE_COPY,
} from "@/lib/reputation/reputation-reply-new-display-copy";
import {
  isReputationReplyNewSubmitBlocked,
  resolveReputationReplyNewFetchErrorBannerMessage,
  resolveReputationReplyNewOrganizationGapMessage,
  resolveReputationReplyNewSubmitButtonLabel,
} from "@/lib/reputation/reputation-reply-new-page-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Status = Database["public"]["Enums"]["reputation_reply_status"];

export default function AdminReputationReplyNewPage() {
  const supabase = createClient();
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [externalReviewId, setExternalReviewId] = useState("");
  const [reviewExcerpt, setReviewExcerpt] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [status, setStatus] = useState<Status>("draft");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const organizationGapMessage = resolveReputationReplyNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolveReputationReplyNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const submitBlocked = isReputationReplyNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    userId: user?.id ?? null,
    facilityReady,
    accountId,
    replyBody,
    accountsLoading,
  });

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setFetchError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setAccounts([]);
      setAccountsLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("reputation_accounts")
        .select("id, label")
        .eq("facility_id", selectedFacilityId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("label", { ascending: true });
      if (qErr) throw qErr;
      setAccounts(data ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load listings.");
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const nowIso = new Date().toISOString();
      const posted = status === "posted";
      const { error: insErr } = await supabase.from("reputation_replies").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        reputation_account_id: accountId,
        external_review_id: externalReviewId.trim() || null,
        review_excerpt: reviewExcerpt.trim() || null,
        reply_body: replyBody.trim(),
        status,
        posted_by_user_id: posted ? user.id : null,
        posted_to_platform_at: posted ? nowIso : null,
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
  const taClass = cn(
    "min-h-[140px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );
  const formDisabled = Boolean(organizationGapMessage) || authLoading;

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New reply
        </h1>
        <Link href="/admin/reputation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {REPUTATION_REPLY_NEW_LOADING_PROFILE_COPY}
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
          <CardTitle className="text-lg">Compose</CardTitle>
          <CardDescription>
            Save as draft while you coordinate approval; choose Posted only after the text is live on the platform.{" "}
            {REPUTATION_REPLY_NEW_ORGANIZATION_SCOPE_COPY}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="acc">Listing</Label>
              {accountsLoading ? (
                <p className="text-sm text-slate-500">Loading listings…</p>
              ) : (
                <select
                  id="acc"
                  required
                  className={selectClass}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={formDisabled || !facilityReady || accounts.length === 0}
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="extrev">External review ID</Label>
              <Input
                id="extrev"
                value={externalReviewId}
                onChange={(e) => setExternalReviewId(e.target.value)}
                className="font-mono text-sm"
                disabled={formDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="excerpt">Review excerpt (optional)</Label>
              <Input
                id="excerpt"
                value={reviewExcerpt}
                onChange={(e) => setReviewExcerpt(e.target.value)}
                disabled={formDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Reply</Label>
              <textarea
                id="body"
                required
                className={taClass}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                spellCheck
                disabled={formDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st">Status</Label>
              <select
                id="st"
                className={selectClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                disabled={formDisabled}
              >
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <Button type="submit" disabled={submitBlocked}>
              {resolveReputationReplyNewSubmitButtonLabel({
                saving,
                authLoading,
                organizationId,
                userId: user?.id ?? null,
                facilityReady,
                accountId,
                replyBody,
                accountsLoading,
              })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
