"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Activity, Ban, Check, Radio, Search, Server, UserPlus, X } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
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
      <></>
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <ReferralsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
          <div className="space-y-3">
             <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
               Referral Inbox
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-muted-foreground max-w-2xl text-balance">
               Electronic referrals received from hospitals, physicians, and referral networks. Link incoming referrals to your pipeline leads
               manually — no automatic lead creation.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={noFacility || exportingCsv}
              className="h-14 rounded-full px-6 font-bold uppercase tracking-wider text-xs"
              title={
                (statusFilter === "all"
                  ? "Export up to 500 messages (all statuses), most recent first."
                  : `Export up to 500 ${statusFilter} messages, most recent first.`) +
                " Search does not narrow the CSV."
              }
              onClick={() => void exportQueueCsv()}
            >
              {exportingCsv ? "Preparing…" : "Download Referrals"}
            </Button>
            <Link
              href="/admin/referrals/hl7-inbound/new"
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-wider text-xs tap-responsive bg-foreground hover:bg-foreground/90 text-background shadow-lg flex items-center gap-2")}
            >
              <Radio className="h-4 w-4" aria-hidden />
              Add Referral
            </Link>
          </div>
        </header>

        <div className="border border-border rounded-[var(--radius)] bg-card shadow-sm overflow-hidden p-6 md:p-8 relative">
           <div className="mb-6 border-b border-border pb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xl font-semibold text-foreground mt-1 flex items-center gap-2">
                 <Server className="h-5 w-5 text-primary" /> Incoming Referrals
              </h3>
              <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-xs">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Input
                    type="search"
                    placeholder="Search referrals..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-[var(--radius)] border-border bg-background text-sm"
                    aria-label="Filter queue by text"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
                  <select
                    className={cn(
                      "h-9 rounded-[var(--radius)] border border-border bg-background px-2.5 text-sm text-foreground outline-none",
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
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
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
               <div className="flex items-center justify-center p-12 text-sm text-muted-foreground font-medium">
                  Loading referrals...
               </div>
             ) : noFacility ? (
               <div className="p-6 rounded-[var(--radius)] bg-warning/10 border border-warning/30 text-warning font-medium text-sm">
                 Select a facility in the header to load the queue.
               </div>
             ) : error ? (
               <div className="p-6 rounded-[var(--radius)] bg-destructive/10 border border-destructive/30 text-destructive font-medium text-sm">
                 {error}
               </div>
             ) : (
               <>
                 <div className="hidden sm:grid grid-cols-[1fr_0.5fr_1fr_2fr_1.5fr_1fr] gap-4 px-[13px] pb-4 border-b border-border relative z-10 text-left">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Received</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Source</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preview</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pipeline Lead</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Actions</div>
                 </div>

                 <div className="space-y-3 mt-6 relative z-10">
                    <MotionList className="space-y-3">
                       {rows.length === 0 ? (
                         <div className="p-12 text-center text-muted-foreground text-sm font-medium bg-muted/10 rounded-[var(--radius)] border border-border">
                            No incoming referrals yet.
                         </div>
                       ) : filteredRows.length === 0 ? (
                         <div className="p-12 text-center text-muted-foreground text-sm font-medium bg-muted/10 rounded-[var(--radius)] border border-border">
                            No messages match this status filter.
                         </div>
                       ) : displayRows.length === 0 ? (
                         <div className="p-12 text-center text-muted-foreground text-sm font-medium bg-muted/10 rounded-[var(--radius)] border border-border">
                            No messages match this search.
                         </div>
                       ) : (
                         displayRows.map((row) => (
                           <MotionItem key={row.id}>
                              <div className="grid grid-cols-1 sm:grid-cols-[1fr_0.5fr_1fr_2fr_1.5fr_1fr] gap-4 sm:items-center min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] w-full outline-none">
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Received / Ctrl ID</span>
                                   <span className="font-semibold text-sm text-foreground tracking-tight tabular-nums">{format(new Date(row.created_at), "MMM d, yyyy p")}</span>
                                   <span className="font-medium text-xs text-muted-foreground mt-0.5 truncate max-w-[150px]">{row.message_control_id ?? "—"}</span>
                                </div>
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Status</span>
                                   <span className={cn(
                                     "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider w-fit capitalize",
                                     row.status === "processed" ? "bg-success/10 text-success border border-success/30" :
                                     row.status === "failed" ? "bg-destructive/10 text-destructive border border-destructive/30" :
                                     row.status === "ignored" ? "bg-muted text-muted-foreground border border-border" :
                                     "bg-warning/10 text-warning border border-warning/30"
                                   )}>
                                     {formatStatus(row.status)}
                                   </span>
                                </div>
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Trigger</span>
                                   <span className="text-sm font-medium text-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-muted-foreground" /> {row.trigger_event ?? "—"}</span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Preview</span>
                                   <div className="bg-muted/10 p-2 rounded-[var(--radius)] border border-border overflow-hidden">
                                     <p className="text-xs font-medium text-muted-foreground truncate max-w-full leading-tight">
                                       {previewRaw(row.raw_message)}
                                     </p>
                                   </div>
                                   <button
                                     type="button"
                                     className="self-start text-[10px] font-bold uppercase tracking-wider text-primary hover:text-primary/80 disabled:opacity-50"
                                     onClick={() => void copyRawMessage(row.id, row.raw_message)}
                                   >
                                     {copiedMessageId === row.id ? "Copied" : "Copy raw"}
                                   </button>
                                </div>
                                <div className="flex flex-col sm:justify-center">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Lead</span>
                                   {row.linked_referral_lead_id ? (
                                     <Link
                                       href={`/admin/referrals/${row.linked_referral_lead_id}`}
                                       className="text-xs font-semibold text-primary hover:text-primary/80 truncate"
                                     >
                                       Open lead
                                     </Link>
                                   ) : row.status === "processed" ? (
                                     <Button
                                       type="button"
                                       variant="outline"
                                       size="sm"
                                       disabled={creatingLeadId === row.id}
                                       onClick={() => void createDraftLead(row)}
                                       className="flex items-center gap-1.5 w-fit"
                                     >
                                       <UserPlus className="w-3.5 h-3.5" />
                                       {creatingLeadId === row.id ? "…" : "Draft lead"}
                                     </Button>
                                   ) : (
                                     <span className="text-xs text-muted-foreground">—</span>
                                   )}
                                </div>
                                <div className="flex flex-col sm:items-end justify-center">
                                   <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-2 mt-2">Actions</span>
                                   <div className="flex flex-wrap items-center justify-end gap-2">
                                     <Button
                                       type="button"
                                       variant="outline"
                                       size="sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "processed")}
                                       className="flex items-center gap-1.5"
                                     >
                                       <Check className="w-3.5 h-3.5" /> Process
                                     </Button>
                                     <Button
                                       type="button"
                                       variant="outline"
                                       size="sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "failed")}
                                       className="flex items-center gap-1.5"
                                     >
                                       <X className="w-3.5 h-3.5" /> Fail
                                     </Button>
                                     <Button
                                       type="button"
                                       variant="outline"
                                       size="sm"
                                       disabled={updatingId === row.id}
                                       onClick={() => void setStatus(row.id, "ignored")}
                                       className="flex items-center gap-1.5"
                                     >
                                       <Ban className="w-3.5 h-3.5" /> Ignore
                                     </Button>
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
