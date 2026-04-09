"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { GOOGLE_IMPORTED_REPLY_PLACEHOLDER } from "@/lib/reputation/google-business-reviews";
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
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type AccountRow = Database["public"]["Tables"]["reputation_accounts"]["Row"];
type ReplyRow = Database["public"]["Tables"]["reputation_replies"]["Row"] & {
  reputation_accounts: { label: string; platform: Database["public"]["Enums"]["reputation_platform"] } | null;
};

function formatPlatform(p: string) {
  return p.replace(/_/g, " ");
}

function buildReputationAccountsCsv(rows: AccountRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "label",
    "platform",
    "is_active",
    "external_place_id",
    "notes",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.label),
      csvEscapeCell(String(row.platform)),
      csvEscapeCell(String(row.is_active)),
      csvEscapeCell(row.external_place_id ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function buildReputationRepliesCsv(rows: ReplyRow[]): string {
  const header = [
    "id",
    "status",
    "listing_label",
    "platform",
    "review_excerpt",
    "reply_body",
    "created_at",
    "posted_to_platform_at",
    "external_review_id",
  ].join(",");
  const body = rows.map((row) => {
    const label = row.reputation_accounts?.label ?? "";
    const platform = row.reputation_accounts?.platform ?? "";
    return [
      csvEscapeCell(row.id),
      csvEscapeCell(row.status),
      csvEscapeCell(label),
      csvEscapeCell(String(platform)),
      csvEscapeCell(row.review_excerpt ?? ""),
      csvEscapeCell(row.reply_body ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.posted_to_platform_at ?? ""),
      csvEscapeCell(row.external_review_id ?? ""),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export default function AdminReputationHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [postingGoogleId, setPostingGoogleId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingAccountsCsv, setExportingAccountsCsv] = useState(false);

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

  const draftReplies = useMemo(() => replies.filter((r) => r.status === "draft"), [replies]);
  const postedReplies = useMemo(() => replies.filter((r) => r.status === "posted"), [replies]);

  async function exportRepliesCsv() {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("reputation_replies")
        .select("*, reputation_accounts(label, platform)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (qErr) throw qErr;
      const rows = (data ?? []) as ReplyRow[];
      const csv = buildReputationRepliesCsv(rows);
      triggerCsvDownload(`reputation-replies_${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }

  async function exportAccountsCsv() {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingAccountsCsv(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("reputation_accounts")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("label", { ascending: true })
        .limit(500);
      if (qErr) throw qErr;
      const rows = (data ?? []) as AccountRow[];
      const csv = buildReputationAccountsCsv(rows);
      triggerCsvDownload(`reputation-accounts_${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingAccountsCsv(false);
    }
  }

  async function saveDraftReplyBody(id: string, reply_body: string) {
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: uErr } = await supabase
        .from("reputation_replies")
        .update({ reply_body, updated_by: user.id })
        .eq("id", id)
        .eq("status", "draft");
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft.");
    }
  }

  async function postReplyToGoogle(id: string) {
    setPostingGoogleId(id);
    setError(null);
    try {
      const res = await fetch(`/api/reputation/replies/${id}/post-google`, { method: "POST" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(j.error ?? "Could not post to Google");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google post failed.");
    } finally {
      setPostingGoogleId(null);
    }
  }

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
      <AmbientMatrix hasCriticals={draftReplies.length > 0}
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-red-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 23 / Reputation & Online Presence</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Reputation Control
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0 self-start">
              <Link
                href="/admin/reputation/integrations"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "default" }),
                  "font-mono uppercase tracking-widest text-[10px]",
                )}
              >
                Integrations
              </Link>
              {facilityReady ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={exportingAccountsCsv}
                    onClick={() => void exportAccountsCsv()}
                  >
                    {exportingAccountsCsv ? "Preparing…" : "Download accounts CSV"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={exportingCsv}
                    onClick={() => void exportRepliesCsv()}
                  >
                    {exportingCsv ? "Preparing…" : "Download replies CSV"}
                  </Button>
                </>
              ) : null}
            </div>
        </header>

        <KineticGrid className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6" staggerMs={75}>
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
            <V2Card hoverColor="red" className={draftReplies.length > 0 ? "border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" : ""}>
              <Sparkline colorClass="text-red-500" variant={2} />
              <MonolithicWatermark value={draftReplies.length} className="text-red-600/5 dark:text-red-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-red-600 dark:text-red-400 flex items-center gap-2">
                     Draft Replies
                  </h3>
                  {draftReplies.length > 0 && <PulseDot colorClass="bg-red-500" />}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1">{draftReplies.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
              <Sparkline colorClass="text-emerald-500" variant={1} />
              <MonolithicWatermark value={postedReplies.length} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400">
                  Posted Replies
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">{postedReplies.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start sm:items-end h-full">
              <div className="relative z-10 text-left sm:text-right w-full">
                 <p className="hidden sm:block text-xs font-mono text-slate-500 mb-4">Connected listings and reply workflow for the selected facility.</p>
                 <div className="flex gap-2 justify-start sm:justify-end">
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

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Draft Replies */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Draft Approvals
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading replies…</p>
              ) : draftReplies.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md">
                   <p className="font-medium">Inbox Zero</p>
                   <p className="text-sm opacity-80">All reputation exceptions resolved.</p>
                </div>
              ) : (
                draftReplies.map((row) => (
                  <MotionItem key={row.id} className="glass-panel rounded-2xl p-6 border border-indigo-500/10 dark:border-indigo-500/5 bg-white/50 dark:bg-slate-900/40 relative overflow-hidden group transition-all hover:bg-white/70 dark:hover:bg-slate-900/60 hover:border-indigo-500/30">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                    <div className="flex justify-between items-start mb-3">
                       <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded-md uppercase tracking-wider">
                         Needs Action
                       </span>
                       <span className="text-xs text-slate-500 font-mono">
                         {format(new Date(row.created_at), "MMM d, yyyy")}
                       </span>
                    </div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                        {row.reputation_accounts?.label ?? "Unknown Listing"}
                      </p>
                      <label className="sr-only" htmlFor={`draft-reply-${row.id}`}>
                        Reply draft
                      </label>
                      <textarea
                        id={`draft-reply-${row.id}`}
                        className="w-full min-h-[88px] rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100"
                        defaultValue={row.reply_body}
                        disabled={postingGoogleId === row.id || updatingId === row.id}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== row.reply_body) void saveDraftReplyBody(row.id, v);
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-start gap-2">
                        {row.reputation_accounts?.platform === "google_business" && row.external_review_id ? (
                          <button
                            type="button"
                            className={cn(
                              buttonVariants({ variant: "default", size: "sm" }),
                              "bg-indigo-600 hover:bg-indigo-700 text-white font-mono uppercase tracking-widest text-[10px]",
                            )}
                            disabled={
                              postingGoogleId === row.id ||
                              row.reply_body.trim() === GOOGLE_IMPORTED_REPLY_PLACEHOLDER ||
                              !row.reply_body.trim()
                            }
                            title={
                              row.reply_body.trim() === GOOGLE_IMPORTED_REPLY_PLACEHOLDER
                                ? "Replace the imported placeholder text before posting to Google."
                                : undefined
                            }
                            onClick={() => void postReplyToGoogle(row.id)}
                          >
                            {postingGoogleId === row.id ? "Posting…" : "Post reply to Google"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-red-600 hover:bg-red-700 text-white font-mono uppercase tracking-widest text-[10px]")}
                          disabled={updatingId === row.id}
                          onClick={() => void markPosted(row.id)}
                        >
                          {updatingId === row.id ? "Recording..." : "Record posted (manual)"}
                        </button>
                    </div>
                  </MotionItem>
                ))
              )}
            </MotionList>
            
            {/* Posted Feed */}
            {postedReplies.length > 0 && (
              <MotionList className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                 <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Recently Posted</h4>
                 {postedReplies.slice(0, 3).map((row) => (
                   <MotionItem key={row.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex gap-4 items-center">
                     <div className="flex-1 min-w-0">
                       <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">{row.reputation_accounts?.label}</p>
                       <p className="text-[10px] text-slate-500 truncate">{row.reply_body}</p>
                     </div>
                     <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                       {row.posted_to_platform_at ? format(new Date(row.posted_to_platform_at), "MMM d") : "Done"}
                     </span>
                   </MotionItem>
                 ))}
              </MotionList>
            )}
            
          </div>

          {/* WATCHLIST: Connected Listings */}
          <div className="col-span-1 border-l border-white/10 dark:border-white/5 pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Integrations Health
              </h3>
            </div>
            
            {loading ? (
              <p className="text-sm font-mono text-slate-500">Loading…</p>
            ) : accounts.length === 0 ? (
               <p className="text-sm text-slate-500 italic">No connected accounts.</p>
            ) : (
               <div className="space-y-2">
                 {accounts.map(row => (
                   <div key={row.id} className="p-3 rounded-xl border border-white/20 dark:border-white/10 bg-white/30 dark:bg-black/20 flex items-center justify-between">
                     <div>
                       <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{row.label}</p>
                       <p className="text-[9px] font-mono text-slate-500 mt-1 uppercase">{formatPlatform(row.platform)}</p>
                     </div>
                     {row.is_active ? (
                       <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                     ) : (
                       <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" />
                     )}
                   </div>
                 ))}
               </div>
            )}
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
