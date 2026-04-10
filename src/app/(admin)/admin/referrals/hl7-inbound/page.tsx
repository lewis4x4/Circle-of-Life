"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Activity, Ban, Check, Radio, Search, Server, UserPlus, X } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { tryParsePid5Name } from "@/lib/referrals/hl7-pid-name";

type Row = Database["public"]["Tables"]["referral_hl7_inbound"]["Row"];
type Status = Database["public"]["Enums"]["referral_hl7_inbound_status"];

const STATUS_FILTERS: { value: "all" | Status; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
  { value: "ignored", label: "Ignored" },
];

function previewRaw(s: string) {
  const t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function buildHl7InboundCsv(rows: Row[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "status",
    "created_at",
    "updated_at",
    "message_control_id",
    "trigger_event",
    "parse_error",
    "linked_referral_lead_id",
    "raw_message",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.status),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.message_control_id ?? ""),
      csvEscapeCell(row.trigger_event ?? ""),
      csvEscapeCell(row.parse_error ?? ""),
      csvEscapeCell(row.linked_referral_lead_id ?? ""),
      csvEscapeCell(row.raw_message ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

export default function AdminReferralsHl7InboundPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [creatingLeadId, setCreatingLeadId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => {
      const hay = [
        r.message_control_id,
        r.trigger_event,
        r.parse_error,
        r.raw_message,
      ]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filteredRows, searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("referral_hl7_inbound")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(75);
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load HL7 queue.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportQueueCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      let query = supabase
        .from("referral_hl7_inbound")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as Row[];
      const csv = buildHl7InboundCsv(exportRows);
      const day = format(new Date(), "yyyy-MM-dd");
      const base = `hl7-inbound-queue_${day}`;
      const filename =
        statusFilter === "all" ? `${base}.csv` : `${base}_${statusFilter}.csv`;
      triggerCsvDownload(filename, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [selectedFacilityId, statusFilter, supabase]);

  async function createDraftLead(row: Row) {
    if (row.status !== "processed" || row.linked_referral_lead_id) return;
    setCreatingLeadId(row.id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      const parsed = tryParsePid5Name(row.raw_message);
      const firstName = parsed?.first_name ?? "HL7";
      const lastName = parsed?.last_name ?? "Referral";
      const notes = [
        "Created from HL7 inbound queue (manual).",
        row.message_control_id ? `Message control ID: ${row.message_control_id}` : null,
        row.trigger_event ? `Trigger: ${row.trigger_event}` : null,
        `Inbound row: ${row.id}`,
      ]
        .filter(Boolean)
        .join("\n");

      const { data: lead, error: insErr } = await supabase
        .from("referral_leads")
        .insert({
          organization_id: row.organization_id,
          facility_id: row.facility_id,
          first_name: firstName,
          last_name: lastName,
          notes,
          external_reference: `hl7:${row.id}`,
          status: "new",
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      if (!lead) throw new Error("No lead returned.");

      const { error: linkErr } = await supabase
        .from("referral_hl7_inbound")
        .update({ linked_referral_lead_id: lead.id, updated_by: user.id })
        .eq("id", row.id);
      if (linkErr) throw linkErr;

      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create lead.";
      if (/duplicate|unique/i.test(msg)) {
        setError("A referral lead already exists for this HL7 message (external reference).");
      } else {
        setError(msg);
      }
    } finally {
      setCreatingLeadId(null);
    }
  }

  async function copyRawMessage(id: string, raw: string | null) {
    const text = raw ?? "";
    if (!text.trim()) {
      setError("Nothing to copy.");
      return;
    }
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(id);
      window.setTimeout(() => {
        setCopiedMessageId((c) => (c === id ? null : c));
      }, 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  async function setStatus(id: string, status: Status) {
    setUpdatingId(id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: uErr } = await supabase
        .from("referral_hl7_inbound")
        .update({ status, updated_by: user.id })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUpdatingId(null);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <ReferralsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               HL7 Inbound
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-balance">
               Raw ADT-style messages queued for the selected facility. Processed messages can be linked to a referral lead
               manually — no automatic lead creation.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={noFacility || exportingCsv}
              className="h-14 rounded-full px-6 font-bold uppercase tracking-widest text-xs"
              title={
                (statusFilter === "all"
                  ? "Export up to 500 messages (all statuses), most recent first."
                  : `Export up to 500 ${statusFilter} messages, most recent first.`) +
                " Search does not narrow the CSV."
              }
              onClick={() => void exportQueueCsv()}
            >
              {exportingCsv ? "Preparing…" : "Download queue CSV"}
            </Button>
            <Link
              href="/admin/referrals/hl7-inbound/new"
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-slate-900 hover:bg-slate-800 text-white shadow-lg flex items-center gap-2 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900")}
            >
              <Radio className="h-4 w-4" aria-hidden />
              Ingest Message
            </Link>
          </div>
        </header>

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                 <Server className="h-5 w-5 text-indigo-500" /> Message Queue
              </h3>
              <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-xs">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <Input
                    type="search"
                    placeholder="Search control ID, trigger, raw…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-lg border-slate-200 bg-white text-sm dark:border-white/10 dark:bg-white/5"
                    aria-label="Filter queue by text"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Status</span>
                  <select
                    className={cn(
                      "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100",
                      "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | Status)}
                  >
                    {STATUS_FILTERS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
                  {rows.length > 0 ? (
                    searchQuery.trim() ? (
                      <>
                        Showing {displayRows.length} of {filteredRows.length} · Search
                      </>
                    ) : (
                      <>
                        Showing {filteredRows.length} of {rows.length} · Most recent first
                      </>
                    )
                  ) : (
                    <>Most recent first</>
                  )}
                </p>
              </div>
           </div>

           <div className="relative z-10 w-full overflow-hidden">
             {loading ? (
               <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium">
                  Loading Queue...
               </div>
             ) : noFacility ? (
               <div className="p-6 rounded-[1.5rem] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 font-medium text-sm">
                 Select a facility in the header to load the queue.
               </div>
             ) : error ? (
               <div className="p-6 rounded-[1.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium text-sm">
                 {error}
               </div>
             ) : (
               <>
                 <div className="hidden sm:grid grid-cols-[1fr_0.5fr_1fr_2fr_1.5fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Received / Ctrl ID</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Trigger</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Preview</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Lead</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Actions</div>
                 </div>

                 <div className="space-y-3 mt-6 relative z-10">
                    <MotionList className="space-y-3">
                       {rows.length === 0 ? (
                         <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                            No HL7 messages yet.
                         </div>
                       ) : filteredRows.length === 0 ? (
                         <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                            No messages match this status filter.
                         </div>
                       ) : displayRows.length === 0 ? (
                         <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                            No messages match this search.
                         </div>
                       ) : (
                         displayRows.map((row) => (
                           <MotionItem key={row.id}>
                              <div className="grid grid-cols-1 sm:grid-cols-[1fr_0.5fr_1fr_2fr_1.5fr_1fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Received / Ctrl ID</span>
                                   <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 tracking-tight">{format(new Date(row.created_at), "MMM d, yyyy p")}</span>
                                   <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[150px]">{row.message_control_id ?? "—"}</span>
                                </div>
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Status</span>
                                   <Badge className={cn("capitalize w-fit text-[10px] uppercase font-bold tracking-widest border-none shadow-none", 
                                     row.status === "processed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" :
                                     row.status === "failed" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400" :
                                     row.status === "ignored" ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" :
                                     "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                                   )}>
                                     {formatStatus(row.status)}
                                   </Badge>
                                </div>
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Trigger</span>
                                   <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-slate-400" /> {row.trigger_event ?? "—"}</span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Preview</span>
                                   <div className="bg-slate-50 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-100 dark:border-white/5 overflow-hidden">
                                     <p className="text-xs font-mono text-slate-600 dark:text-slate-400 truncate max-w-full leading-tight">
                                       {previewRaw(row.raw_message)}
                                     </p>
                                   </div>
                                   <button
                                     type="button"
                                     className="self-start text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 disabled:opacity-50"
                                     onClick={() => void copyRawMessage(row.id, row.raw_message)}
                                   >
                                     {copiedMessageId === row.id ? "Copied" : "Copy raw"}
                                   </button>
                                </div>
                                <div className="flex flex-col sm:justify-center">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Lead</span>
                                   {row.linked_referral_lead_id ? (
                                     <Link
                                       href={`/admin/referrals/${row.linked_referral_lead_id}`}
                                       className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 truncate"
                                     >
                                       Open lead
                                     </Link>
                                   ) : row.status === "processed" ? (
                                     <button
                                       type="button"
                                       className="inline-flex items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 h-8 px-3 text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors disabled:opacity-50 border border-indigo-200 dark:border-indigo-500/20 gap-1.5 shadow-sm w-fit"
                                       disabled={creatingLeadId === row.id}
                                       onClick={() => void createDraftLead(row)}
                                     >
                                       <UserPlus className="w-3.5 h-3.5" />
                                       {creatingLeadId === row.id ? "…" : "Draft lead"}
                                     </button>
                                   ) : (
                                     <span className="text-xs text-slate-400">—</span>
                                   )}
                                </div>
                                <div className="flex flex-col sm:items-end justify-center">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-2 mt-2">Actions</span>
                                   <div className="flex flex-wrap items-center justify-end gap-2">
                                     <button
                                       type="button"
                                       className="inline-flex items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 h-8 px-3 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50 border border-emerald-200 dark:border-emerald-500/20 gap-1.5 shadow-sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "processed")}
                                     >
                                       <Check className="w-3.5 h-3.5" /> Process
                                     </button>
                                     <button
                                       type="button"
                                       className="inline-flex items-center justify-center rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 h-8 px-3 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors disabled:opacity-50 border border-rose-200 dark:border-rose-500/20 gap-1.5 shadow-sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "failed")}
                                     >
                                       <X className="w-3.5 h-3.5" /> Fail
                                     </button>
                                     <button
                                       type="button"
                                       className="inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 h-8 px-3 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50 gap-1.5 shadow-sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "ignored")}
                                     >
                                       <Ban className="w-3.5 h-3.5" /> Ignore
                                     </button>
                                   </div>
                                </div>
                              </div>
                           </MotionItem>
                         ))
                       )}
                    </MotionList>
                 </div>
               </>
             )}
           </div>
        </div>
      </div>
    </div>
  );
}
