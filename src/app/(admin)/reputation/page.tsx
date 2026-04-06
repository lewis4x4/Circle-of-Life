"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type AccountRow = Database["public"]["Tables"]["reputation_accounts"]["Row"];
type ReplyRow = Database["public"]["Tables"]["reputation_replies"]["Row"] & {
  reputation_accounts: { label: string; platform: Database["public"]["Enums"]["reputation_platform"] } | null;
};

function formatPlatform(p: string) {
  return p.replace(/_/g, " ");
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminReputationHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setAccounts([]);
      setReplies([]);
      setLoading(false);
      return;
    }
    try {
      const [aRes, rRes] = await Promise.all([
        supabase
          .from("reputation_accounts")
          .select("*")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("label", { ascending: true })
          .limit(50),
        supabase
          .from("reputation_replies")
          .select("*, reputation_accounts(label, platform)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      if (aRes.error) throw aRes.error;
      if (rRes.error) throw rRes.error;
      setAccounts(aRes.data ?? []);
      setReplies((rRes.data ?? []) as ReplyRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reputation data.");
      setAccounts([]);
      setReplies([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markPosted(id: string) {
    setUpdatingId(id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: uErr } = await supabase
        .from("reputation_replies")
        .update({
          status: "posted",
          posted_by_user_id: user.id,
          posted_to_platform_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUpdatingId(null);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Reputation
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Connected listings and reply workflow for the selected facility. API sync is Enhanced.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/reputation/accounts/new"
            className={cn(buttonVariants({ variant: "default" }), "inline-flex items-center gap-2")}
          >
            <Star className="h-4 w-4" aria-hidden />
            Add listing
          </Link>
          <Link href="/admin/reputation/replies/new" className={cn(buttonVariants({ variant: "secondary" }))}>
            New reply
          </Link>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load reputation accounts and replies.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Listings</CardTitle>
          <CardDescription>Review surfaces tracked for this site (manual identifiers in Core).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : accounts.length === 0 ? (
            <p className="text-sm text-slate-500">No listings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Place / external ID</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-sm capitalize">{formatPlatform(row.platform)}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {row.external_place_id ?? "—"}
                    </TableCell>
                    <TableCell>{row.is_active ? "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Replies</CardTitle>
          <CardDescription>
            Draft and posted responses. After you publish on the platform, use Record posted to capture who logged it and when.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : replies.length === 0 ? (
            <p className="text-sm text-slate-500">No replies yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="max-w-[200px]">Reply preview</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replies.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">
                      {row.reputation_accounts ? (
                        <>
                          {row.reputation_accounts.label}{" "}
                          <span className="text-xs text-slate-500">({formatPlatform(row.reputation_accounts.platform)})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-slate-600 dark:text-slate-300">
                      {row.reply_body}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(row.created_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "draft" ? (
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                          disabled={updatingId === row.id}
                          onClick={() => void markPosted(row.id)}
                        >
                          Record posted
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {row.posted_to_platform_at
                            ? format(new Date(row.posted_to_platform_at), "MMM d, yyyy")
                            : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
