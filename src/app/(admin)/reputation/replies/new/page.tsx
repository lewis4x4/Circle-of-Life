"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Status = Database["public"]["Enums"]["reputation_reply_status"];

export default function AdminReputationReplyNewPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [externalReviewId, setExternalReviewId] = useState("");
  const [reviewExcerpt, setReviewExcerpt] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [status, setStatus] = useState<Status>("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setAccounts([]);
      setLoading(false);
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
      setError(e instanceof Error ? e.message : "Failed to load listings.");
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !accountId || !replyBody.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const nowIso = new Date().toISOString();
      const posted = status === "posted";
      const { error: insErr } = await supabase.from("reputation_replies").insert({
        organization_id: ctx.ctx.organizationId,
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
      if (insErr) throw insErr;
      router.push("/admin/reputation");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );
  const taClass = cn(
    "min-h-[140px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New reply
        </h1>
        <Link href="/admin/reputation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {!facilityReady && (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Compose</CardTitle>
          <CardDescription>
            Save as draft while you coordinate approval; choose Posted only after the text is live on the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="acc">Listing</Label>
              {loading ? (
                <p className="text-sm text-slate-500">Loading listings…</p>
              ) : (
                <select
                  id="acc"
                  required
                  className={selectClass}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={!facilityReady || accounts.length === 0}
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="excerpt">Review excerpt (optional)</Label>
              <Input id="excerpt" value={reviewExcerpt} onChange={(e) => setReviewExcerpt(e.target.value)} />
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st">Status</Label>
              <select id="st" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <Button type="submit" disabled={saving || !facilityReady || !accountId || !replyBody.trim()}>
              {saving ? "Saving…" : "Save reply"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
