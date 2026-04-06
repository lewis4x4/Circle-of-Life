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
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={replies.filter(r => r.status === 'draft').length > 0} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-red-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 10 / Reputation Settings</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Reputation Control
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={accounts.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <Star className="h-3.5 w-3.5" /> Tracked Listings
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{accounts.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="red" className={replies.filter(r => r.status === 'draft').length > 0 ? "border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" : ""}>
              <Sparkline colorClass="text-red-500" variant={2} />
              <MonolithicWatermark value={replies.filter(r => r.status === 'draft').length} className="text-red-600/5 dark:text-red-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-red-600 dark:text-red-400 flex items-center gap-2">
                     Draft Replies
                  </h3>
                  {replies.filter(r => r.status === 'draft').length > 0 && <PulseDot colorClass="bg-red-500" />}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1">{replies.filter(r => r.status === 'draft').length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Connected listings and reply workflow for the selected facility.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/reputation/accounts/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                     + Connect Listing
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

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

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Listings</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Review surfaces tracked for this site (manual identifiers in Core).</p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4 sm:p-6">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : accounts.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No listings yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Place / external ID</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group">
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
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Replies</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">
            Draft and posted responses. After you publish on the platform, use Record posted to capture who logged it and when.
          </p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4 sm:p-6">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : replies.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No replies yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Listing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="max-w-[200px]">Reply preview</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replies.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-500/5 dark:hover:bg-slate-500/10 transition-colors cursor-pointer group">
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
        </div>
      </div>
      </div>
    </div>
  );
}
