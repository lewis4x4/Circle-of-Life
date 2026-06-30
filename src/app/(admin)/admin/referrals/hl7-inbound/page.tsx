"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Activity,
  Ban,
  Check,
  ClipboardCopy,
  Download,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { tryParsePid5Name } from "@/lib/referrals/hl7-pid-name";
import {
  hl7InboxRangeStartUtc,
  type Hl7InboxRangeKey,
} from "@/lib/referrals/hl7-inbox-range";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Note } from "@/design-system/components/Note";
import { Pagination } from "@/design-system/components/Pagination";

type Row = Database["public"]["Tables"]["referral_hl7_inbound"]["Row"];
type Hl7Status = Database["public"]["Enums"]["referral_hl7_inbound_status"];

export type QueueKey = "all" | "unlinked" | "linked" | "ignored" | "duplicate";

const PAGE_SIZE = 25;

function previewRaw(s: string) {
  const t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function duplicateControlIds(rows: Row[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = r.message_control_id?.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [key, count] of counts) {
    if (count > 1) dup.add(key);
  }
  return dup;
}

function matchesSearch(row: Row, raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.message_control_id,
    row.trigger_event,
    row.parse_error,
    row.raw_message,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

function applyQueue(rows: Row[], queue: QueueKey, dupIds: Set<string>): Row[] {
  if (queue === "all") return rows;
  if (queue === "unlinked") {
    return rows.filter(
      (r) => !r.linked_referral_lead_id && r.status !== "ignored",
    );
  }
  if (queue === "linked") return rows.filter((r) => Boolean(r.linked_referral_lead_id));
  if (queue === "ignored") return rows.filter((r) => r.status === "ignored");
  return rows.filter((r) => {
    const mid = r.message_control_id?.trim();
    return Boolean(mid && dupIds.has(mid));
  });
}

function parseQueue(raw: string | null): QueueKey {
  switch (raw) {
    case "all":
    case "unlinked":
    case "linked":
    case "ignored":
    case "duplicate":
      return raw;
    default:
      return "unlinked";
  }
}

function parseRange(raw: string | null): Hl7InboxRangeKey {
  switch (raw) {
    case "today":
    case "7d":
    case "30d":
    case "all":
      return raw;
    default:
      return "30d";
  }
}

function parseReceivedDir(raw: string | null): "asc" | "desc" {
  return raw === "asc" ? "asc" : "desc";
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
  const { user } = useHavenAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [creatingLeadId, setCreatingLeadId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());

  const queueFilter = parseQueue(searchParams.get("queue"));
  const rangeKey = parseRange(searchParams.get("range"));
  const receivedDir = parseReceivedDir(searchParams.get("received"));
  const queryText = searchParams.get("q") ?? "";
  const pageParamRaw = Number.parseInt(searchParams.get("pg") ?? "1", 10);
  const pageNum =
    Number.isFinite(pageParamRaw) && pageParamRaw > 0 ? pageParamRaw : 1;

  type QueryPatch =
    | {
        mode: "set";
        pairs: Record<string, string>;
        resetPage?: boolean;
      }
    | { mode: "delete"; keys: string[]; resetPage?: boolean };

  const replaceQuery = useCallback(
    (updater: QueryPatch) => {
      const next = new URLSearchParams(searchParams.toString());
      if (updater.mode === "set") {
        for (const [k, v] of Object.entries(updater.pairs)) {
          next.set(k, v);
        }
        let resetPg = updater.resetPage;
        if (resetPg === undefined) {
          const keys = Object.keys(updater.pairs);
          resetPg = keys.some((k) => !["pg", "received"].includes(k));
        }
        if (resetPg) next.set("pg", "1");
      } else {
        for (const k of updater.keys) next.delete(k);
        if (updater.resetPage) next.set("pg", "1");
      }
      const qs = next.toString();
      router.replace(qs.length ? `${pathname}?${qs}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let changed = false;
    const next = new URLSearchParams(searchParams.toString());
    if (!searchParams.has("queue")) {
      next.set("queue", "unlinked");
      changed = true;
    }
    if (!searchParams.has("range")) {
      next.set("range", "30d");
      changed = true;
    }
    if (!searchParams.has("received")) {
      next.set("received", "desc");
      changed = true;
    }
    if (!changed) return;
    const qs = next.toString();
    router.replace(qs.length ? `${pathname}?${qs}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  const rangeStartIso = hl7InboxRangeStartUtc(rangeKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      let q = supabase
        .from("referral_hl7_inbound")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(750);
      if (rangeStartIso) {
        q = q.gte("created_at", rangeStartIso);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load inbound referrals.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId, rangeStartIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const dupIds = useMemo(() => duplicateControlIds(rows), [rows]);

  const pipelineFiltered = useMemo(() => {
    return applyQueue(rows, queueFilter, dupIds).sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      return receivedDir === "asc" ? ta - tb : tb - ta;
    });
  }, [rows, queueFilter, dupIds, receivedDir]);

  const searchedRows = useMemo(() => {
    return pipelineFiltered.filter((r) => matchesSearch(r, queryText));
  }, [pipelineFiltered, queryText]);

  const pageCount = Math.max(1, Math.ceil(searchedRows.length / PAGE_SIZE));
  const safePage = Math.min(pageNum, pageCount);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return searchedRows.slice(start, start + PAGE_SIZE);
  }, [searchedRows, safePage]);

  const toggleReceivedSort = () => {
    replaceQuery({
      mode: "set",
      pairs: { received: receivedDir === "asc" ? "desc" : "asc" },
      resetPage: false,
    });
  };

  const exportInboundCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId))
      return;
    setExportingCsv(true);
    setError(null);
    try {
      let api = supabase
        .from("referral_hl7_inbound")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: receivedDir === "asc" })
        .limit(2500);

      if (rangeStartIso) {
        api = api.gte("created_at", rangeStartIso);
      }

      const { data, error: qErr } = await api;
      if (qErr) throw qErr;
      const fetched = (data ?? []) as Row[];
      const exportDupIds = duplicateControlIds(fetched);
      let exportRows = applyQueue(fetched, queueFilter, exportDupIds);
      exportRows = exportRows.filter((r) => matchesSearch(r, queryText));
      exportRows.sort((a, b) => {
        const ta = Date.parse(a.created_at);
        const tb = Date.parse(b.created_at);
        return receivedDir === "asc" ? ta - tb : tb - ta;
      });

      const csv = buildHl7InboundCsv(exportRows);
      const day = format(new Date(), "yyyy-MM-dd");
      triggerCsvDownload(
        `referral-inbox_${day}_${queueFilter}_${rangeKey}_${receivedDir}.csv`,
        csv,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [
    queueFilter,
    queryText,
    rangeKey,
    rangeStartIso,
    receivedDir,
    selectedFacilityId,
    supabase,
  ]);

  async function createDraftLead(row: Row) {
    if (row.status !== "processed" || row.linked_referral_lead_id) return;
    setCreatingLeadId(row.id);
    setError(null);
    try {
      if (!user?.id) throw new Error("Sign in required.");

      const parsed = tryParsePid5Name(row.raw_message);
      const firstName = parsed?.first_name ?? "HL7";
      const lastName = parsed?.last_name ?? "Referral";
      const notes = [
        "Created from HL7 inbound queue (manual).",
        row.message_control_id
          ? `Message control ID: ${row.message_control_id}`
          : null,
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
        .update({
          linked_referral_lead_id: lead.id,
          updated_by: user.id,
        })
        .eq("id", row.id);
      if (linkErr) throw linkErr;

      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create lead.";
      if (/duplicate|unique/i.test(msg)) {
        setError(
          "A referral lead already exists for this HL7 message (duplicate external reference).",
        );
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

  async function setStatus(id: string, status: Hl7Status) {
    setUpdatingId(id);
    setError(null);
    try {
      if (!user?.id) throw new Error("Sign in required.");
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

  const noFacility =
    !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const headerSelectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = headerSelectRef.current;
    if (!el) return;
    const visibleIds = new Set(pagedRows.map((r) => r.id));
    let selectedVisible = 0;
    for (const id of selectedIds) {
      if (visibleIds.has(id)) selectedVisible++;
    }
    el.indeterminate =
      selectedVisible > 0 && selectedVisible < pagedRows.length;
    el.checked = pagedRows.length > 0 && selectedVisible === pagedRows.length;
  }, [pagedRows, selectedIds]);

  const toggleHeaderSelect = () => {
    const visibleIds = new Set(pagedRows.map((r) => r.id));
    const allSelected =
      visibleIds.size > 0 &&
      [...visibleIds].every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of visibleIds) next.delete(id);
    } else {
      for (const id of visibleIds) next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleRowSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const queueChips: { id: QueueKey; label: string }[] = [
    { id: "all", label: "All" },
    { id: "unlinked", label: "Unlinked" },
    { id: "linked", label: "Linked" },
    { id: "ignored", label: "Ignored" },
    { id: "duplicate", label: "Duplicate" },
  ];

  const rangeChips: { id: Hl7InboxRangeKey; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7 days" },
    { id: "30d", label: "Last 30 days" },
    { id: "all", label: "All" },
  ];

  const selectedBulkCount = selectedIds.size;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <TooltipProvider delay={280}>
        <div className="relative z-10 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <PageHeader
            title="Referral inbox"
            subtitle="Electronic referrals from hospitals, physicians, and referral networks."
            actions={
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="default"
                  disabled={noFacility || exportingCsv}
                  aria-label={
                    exportingCsv
                      ? "Preparing CSV export…"
                      : "Export inbound referrals CSV"
                  }
                  className="shrink-0 gap-2"
                  onClick={() => void exportInboundCsv()}
                >
                  <Download className="size-4" aria-hidden />
                  {exportingCsv ? "Preparing…" : "Export CSV"}
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    aria-label="Manually log a referral"
                    render={
                      <Link
                        href="/admin/referrals/hl7-inbound/new"
                        className={cn(
                          buttonVariants({
                            variant: "default",
                            size: "default",
                          }),
                          "inline-flex min-w-[140px] shrink-0 items-center gap-1.5",
                        )}
                      />
                    }
                  >
                    <Plus className="size-4" aria-hidden />
                    <span>Log referral</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    Log a referral that arrived by phone, fax, or in person.
                  </TooltipContent>
                </Tooltip>
              </>
            }
          />

          <Note tone="info">
            Linking is manual — referrals do not auto-create pipeline leads.{` `}
            <Link
              href="/admin/referrals/sources"
              className="text-primary underline-offset-4 hover:underline"
            >
              Learn more about sources &amp; connections
            </Link>
            .
          </Note>

          <ReferralsHubNav />

          <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                Incoming referrals
              </h2>
              <Label className="mt-3 text-xs font-semibold tracking-normal text-muted-foreground md:text-[13px]">
                Status
              </Label>
              <div className="flex flex-wrap gap-2">
                {queueChips.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant={queueFilter === c.id ? "secondary" : "ghost"}
                    className="h-8"
                    onClick={() =>
                      replaceQuery({
                        mode: "set",
                        pairs: { queue: c.id },
                        resetPage: true,
                      })
                    }
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              <Label className="mt-3 text-xs font-semibold tracking-normal text-muted-foreground md:text-[13px]">
                Range
              </Label>
              <div className="flex flex-wrap gap-2">
                {rangeChips.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant={rangeKey === c.id ? "secondary" : "ghost"}
                    className="h-8"
                    onClick={() =>
                      replaceQuery({
                        mode: "set",
                        pairs: { range: c.id },
                        resetPage: true,
                      })
                    }
                  >
                    {c.label}
                  </Button>
                ))}
              </div>

              <div className="mt-4 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
                  <Search
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    placeholder="Search by sender, patient name, or ID…"
                    value={queryText}
                    aria-label="Search inbound referrals"
                    onChange={(e) =>
                      replaceQuery({
                        mode: "set",
                        pairs: { q: e.target.value },
                        resetPage: true,
                      })
                    }
                    className="h-9 rounded-[var(--radius)] border-border bg-background text-sm"
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
                Loading inbound referrals…
              </div>
            ) : noFacility ? (
              <div className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 p-4 text-sm font-medium text-warning">
                Select a facility in the header to load inbound referrals.
              </div>
            ) : error ? (
              <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium text-destructive">
                {error}
              </div>
            ) : (
              <>
                {selectedBulkCount > 0 ? (
                  <div
                    className="mb-4 flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    role="status"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {selectedBulkCount === 1
                        ? "1 referral selected"
                        : `${selectedBulkCount} referrals selected`}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled>
                        Link to lead
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled>
                        Ignore
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled>
                        Mark duplicate
                      </Button>
                    </div>
                  </div>
                ) : null}

                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-11 text-center [&:has([role=checkbox])]:pr-0">
                        <input
                          ref={headerSelectRef}
                          type="checkbox"
                          aria-label="Select visible inbound referrals"
                          className="peer size-4 rounded border-input accent-foreground disabled:opacity-40"
                          onChange={() => toggleHeaderSelect()}
                        />
                      </TableHead>
                      <TableHead>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-auto gap-1 px-2 py-0 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                          aria-sort={
                            receivedDir === "desc" ? "descending" : "ascending"
                          }
                          onClick={toggleReceivedSort}
                        >
                          Received
                          {receivedDir === "desc" ? (
                            <ArrowDownWideNarrow className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowUpWideNarrow className="size-3.5" aria-hidden />
                          )}
                        </Button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Preview</TableHead>
                      <TableHead>Pipeline lead</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="whitespace-normal py-10 align-top"
                        >
                          <div className="max-w-xl space-y-2 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">
                              No incoming referrals yet.
                            </p>
                            <p>
                              Electronic referrals from connected sources appear
                              here when they arrive. Not seeing referrals you
                              expected?
                            </p>
                            <p>
                              <Link
                                href="/admin/referrals/sources"
                                className="text-primary underline-offset-4 hover:underline"
                              >
                                Check inbound integration status on sources →
                              </Link>
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : pipelineFiltered.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-sm text-muted-foreground"
                        >
                          No referrals match these filters yet.
                        </TableCell>
                      </TableRow>
                    ) : searchedRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-sm text-muted-foreground"
                        >
                          No inbound referrals match this search for the
                          current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-center">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-input accent-foreground disabled:opacity-40"
                              aria-label="Select inbound referral row"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRowSelect(row.id)}
                            />
                          </TableCell>
                          <TableCell className="tabular-nums text-sm font-medium leading-tight text-foreground">
                            <span className="block">
                              {format(new Date(row.created_at), "MMM d, yyyy p")}
                            </span>
                            <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                              {row.message_control_id ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusPill
                              tone={
                                row.status === "failed"
                                  ? "destructive"
                                  : row.status === "processed" ||
                                      row.status === "ignored"
                                    ? "neutral"
                                    : "warning"
                              }
                            >
                              {formatStatus(row.status)}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="whitespace-normal font-medium leading-snug">
                            <span className="inline-flex items-center gap-1.5">
                              <Activity
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              {row.trigger_event ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="max-w-xl space-y-1.5">
                              <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-muted/10 p-2">
                                <p className="break-words text-xs font-medium leading-snug text-muted-foreground">
                                  {previewRaw(row.raw_message)}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="link"
                                size="xs"
                                className="inline-flex px-0"
                                aria-label={`Copy raw message`}
                                onClick={() =>
                                  void copyRawMessage(row.id, row.raw_message)
                                }
                              >
                                <ClipboardCopy className="size-3 sm:mr-1" aria-hidden />
                                <span className="hidden sm:inline">
                                  {copiedMessageId === row.id
                                    ? "Copied"
                                    : "Copy raw"}
                                </span>
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {row.linked_referral_lead_id ? (
                              <Link
                                href={`/admin/referrals/${row.linked_referral_lead_id}`}
                                className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
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
                                className="gap-1.5"
                              >
                                <UserPlus className="size-3.5" aria-hidden />
                                {creatingLeadId === row.id
                                  ? "Saving…"
                                  : "Draft lead"}
                              </Button>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updatingId === row.id}
                                className="gap-1"
                                onClick={() =>
                                  void setStatus(row.id, "processed")
                                }
                              >
                                <Check className="size-3.5" aria-hidden />
                                Process
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updatingId === row.id}
                                className="gap-1"
                                onClick={() => void setStatus(row.id, "failed")}
                              >
                                <X className="size-3.5" aria-hidden />
                                Fail
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updatingId === row.id}
                                className="gap-1"
                                onClick={() =>
                                  void setStatus(row.id, "ignored")
                                }
                              >
                                <Ban className="size-3.5" aria-hidden />
                                Ignore
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {searchedRows.length === 0 ? 0 : pagedRows.length} of{" "}
                    {searchedRows.length} referrals
                  </p>
                  {searchedRows.length > 25 ? (
                    <Pagination
                      page={safePage}
                      pageCount={pageCount}
                      onPageChange={(next) =>
                        replaceQuery({
                          mode: "set",
                          pairs: { pg: String(next) },
                          resetPage: false,
                        })
                      }
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
