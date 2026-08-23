"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FACILITY_AUDIT_ACTION_UI,
  FACILITY_AUDIT_CAPTURE_BUCKETS,
  FACILITY_AUDIT_ENTITY_OPTIONS,
  FACILITY_AUDIT_SOURCE_OPTIONS,
  type FacilityAuditEntityFilterKey,
  type FacilityAuditSourceFilter,
  buildFacilityAuditEntityHref,
  entityKeysToTableNames,
} from "@/lib/admin/facilities/facility-audit-ui";
import type { FacilityAuditMetricsPayload } from "@/hooks/useFacilityAuditMetrics";
import { type AuditLogFilters, type FacilityAuditHookRow, useFacilityAuditLog } from "@/hooks/useFacilityAuditLog";
import {
  auditTabIsoToday,
  auditTabRangeFromPreset,
  type AuditTabDatePreset,
} from "@/lib/facilities/audit-tab-date-range";
import {
  formatAuditTabLastEventRelative,
  formatAuditTabNewValue,
  formatAuditTabOldValue,
} from "@/lib/facilities/audit-tab-display-copy";
import { cn } from "@/lib/utils";
import { Loader2, Download, Filter } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
const LS_VIEWS = "haven:facility-audit-log:saved-view";
const PER_PAGE = 50;

interface AuditTabProps {
  facilityId: string;
  suspectedSurfaceSignals: boolean;
  metricsSummary?: FacilityAuditMetricsPayload | null;
}

type DatePreset = AuditTabDatePreset;

const ENTITY_ALL = new Set<FacilityAuditEntityFilterKey>(FACILITY_AUDIT_ENTITY_OPTIONS.map((o) => o.key));
const DEFAULT_ACTION_KEYS = FACILITY_AUDIT_ACTION_UI.map((a) => a.key);

type ParticipantOpt = { id: string; label: string };

export function AuditTab({ facilityId, suspectedSurfaceSignals, metricsSummary }: AuditTabProps) {
  const { entries, isLoading, error, total, page, hasNext, refetch } = useFacilityAuditLog(facilityId);

  const [preset, setPreset] = useState<DatePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [from, setFrom] = useState(() => auditTabRangeFromPreset("30d").from);
  const [to, setTo] = useState(() => auditTabRangeFromPreset("30d").to);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [entityKeys, setEntityKeys] = useState<Set<FacilityAuditEntityFilterKey>>(() => new Set(ENTITY_ALL));
  const [actionKeys, setActionKeys] = useState<Set<string>>(() => new Set(DEFAULT_ACTION_KEYS));

  const [participants, setParticipants] = useState<ParticipantOpt[]>([]);
  /** `null` = all authenticated actors allowed by query. Otherwise restrict to IDs. */
  const [actorSubset, setActorSubset] = useState<string[] | null>(null);

  const [source, setSource] = useState<FacilityAuditSourceFilter>("any");
  const [savedView, setSavedView] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const stored = window.localStorage.getItem(LS_VIEWS);
      if (stored) return JSON.parse(stored) as string;
    } catch {
      /* noop */
    }
    return "all";
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const tableFilterList = useMemo(() => entityKeysToTableNames(entityKeys), [entityKeys]);
  const tableFilterToken = tableFilterList.join("|");
  const actionToken = [...actionKeys].sort().join(",");
  const actorToken =
    actorSubset == null ? "ALL" : actorSubset.slice().sort().join(",");

  const reload = useCallback(
    async (nextPage: number) => {
      const payload: AuditLogFilters = {
        page: nextPage,
        pageSize: PER_PAGE,
        startDate: from,
        endDate: to,
        search: debouncedSearch || undefined,
        table_name_in: tableFilterList.length > 0 ? tableFilterList : undefined,
        action_in: [...actionKeys].sort(),
        user_ids:
          actorSubset != null && actorSubset.length > 0 ? [...actorSubset] : undefined,
      };
      await refetch(payload);
    },
    [
      refetch,
      from,
      to,
      debouncedSearch,
      tableFilterList,
      actionKeys,
      actorSubset,
    ],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    window.setTimeout(() => {
      if (cancelled) return;
      void reload(1);
    }, 0);
    return () => {
      cancelled = true;
    };
  }, [facilityId, debouncedSearch, from, to, tableFilterToken, actionToken, actorToken, reload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/facilities/${facilityId}/audit-log/participants?${params}`);
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as { data: ParticipantOpt[] };
      setParticipants(json.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, from, to]);

  useEffect(() => {
    /* Keep actor subset sane when participant list reshapes — drop unknown IDs. */
    if (actorSubset == null || participants.length === 0) return;
    const allow = new Set(participants.map((p) => p.id));
    const next = actorSubset.filter((id) => allow.has(id));
    if (next.length !== actorSubset.length) {
      window.setTimeout(() => setActorSubset(next.length === 0 ? null : next), 0);
    }
  }, [actorSubset, participants]);

  const filterCount =
    Number(debouncedSearch.length > 0) +
    Number(preset !== "30d") +
    Number(entityKeys.size !== ENTITY_ALL.size) +
    Number(actionKeys.size !== DEFAULT_ACTION_KEYS.length) +
    Number(actorSubset != null && actorSubset.length > 0) +
    Number(source !== "any");

  const filtersActive =
    debouncedSearch.length > 0 ||
    entityKeys.size !== ENTITY_ALL.size ||
    actionKeys.size !== DEFAULT_ACTION_KEYS.length ||
    actorSubset != null ||
    source !== "any" ||
    preset !== "30d";

  function applyPreset(p: Exclude<DatePreset, "custom">) {
    setPreset(p);
    const r = auditTabRangeFromPreset(p);
    setFrom(r.from);
    setTo(r.to);
  }

  function applyCustomDates() {
    if (!customFrom || !customTo) return;
    setPreset("custom");
    const a = customFrom <= customTo ? customFrom : customTo;
    const b = customFrom <= customTo ? customTo : customFrom;
    setFrom(a);
    setTo(b);
  }

  const resetFilters = () => {
    setPreset("30d");
    const r30 = auditTabRangeFromPreset("30d");
    setFrom(r30.from);
    setTo(r30.to);
    setCustomFrom("");
    setCustomTo("");
    setSearchInput("");
    setDebouncedSearch("");
    setEntityKeys(new Set(ENTITY_ALL));
    setActionKeys(new Set(DEFAULT_ACTION_KEYS));
    setActorSubset(null);
    setSource("any");
  };

  function applySavedView(key: string) {
    try {
      window.localStorage.setItem(LS_VIEWS, JSON.stringify(key));
    } catch {
      /* noop */
    }
    setSavedView(key);
    resetFilters();
    window.requestAnimationFrame(() => {
      if (key === "license") setEntityKeys(new Set(["facility" as FacilityAuditEntityFilterKey]));
      else if (key === "documents") setEntityKeys(new Set(["document"]));
      else if (key === "vendors") setEntityKeys(new Set(["vendor"]));
      else if (key === "rates") setEntityKeys(new Set(["rate"]));
      else if (key === "deletes") setActionKeys(new Set(["DELETE"]));
    });
  }

  const exportCsv = useCallback(async () => {
    const qs = new URLSearchParams({
      page: "1",
      per_page: "5000",
      from,
      to,
    });
    if (debouncedSearch) qs.set("search", debouncedSearch);
    const tables = tableFilterToken ? tableFilterToken.split("|") : [];
    if (tables.length > 0) qs.set("table_name_in", tables.join(","));
    const acts = actionToken.split(",").filter(Boolean);
    if (acts.length > 0) qs.set("action_in", acts.join(","));
    const actors = actorToken === "ALL" ? [] : actorToken.split(",").filter(Boolean);
    if (actors.length > 0) qs.set("user_ids", actors.join(","));

    const res = await fetch(`/api/admin/facilities/${facilityId}/audit-log?${qs}`);
    if (!res.ok) return;
    const json = (await res.json()) as {
      data: FacilityAuditHookRow[];
    };

    const rows = json.data ?? [];
    const header = ["Timestamp", "User", "Action", "Table", "Field", "Summary", "Old", "New"] as const;
    const csv = [
      header.join(","),
      ...rows.map((e) =>
        [
          e.timestamp,
          e.changed_by_display,
          e.action,
          e.table_name,
          e.field_name ?? "",
          e.summary.replace(/,/g, " "),
          (e.old_value_text ?? "").replace(/,/g, " "),
          (e.new_value_text ?? "").replace(/,/g, " "),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facility-${facilityId}-audit-${auditTabIsoToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [actorToken, actionToken, debouncedSearch, facilityId, from, tableFilterToken, to]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (typing && e.key !== "Escape") return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-audit-log-search]")?.focus();
      }
      if (e.key.toLowerCase() === "e" && !typing) void exportCsv();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exportCsv]);

  function actionChipCls(action: string): string {
    if (action === "INSERT") return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    if (action === "UPDATE") return "bg-primary/10 text-primary";
    if (action === "DELETE") return "bg-destructive/15 text-destructive";
    return "bg-muted text-muted-foreground";
  }

  function toggleParticipant(id: string) {
    setActorSubset((prev) => {
      const set = new Set(prev ?? []);
      if (set.has(id)) {
        set.delete(id);
        return set.size === 0 ? null : [...set];
      }
      set.add(id);
      return [...set];
    });
  }

  const eventsAllTime = metricsSummary?.events_all_time ?? null;
  const showSetupWarning =
    !filtersActive && total === 0 && suspectedSurfaceSignals && eventsAllTime === 0;

  const summaryLine = (() => {
    const n = total;
    const m = participants.length;
    const relative = formatAuditTabLastEventRelative(metricsSummary?.last_event_at);
    return `Showing ${n} event${n === 1 ? "" : "s"} from ${m} user${m === 1 ? "" : "s"} · Last event ${relative}`;
  })();

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-[12px] font-medium text-muted-foreground" htmlFor="audit-search">
            Search
          </label>
          <Input
            id="audit-search"
            data-audit-log-search
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="User, table, field…"
            className="h-10"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Press / to focus</p>
        </div>

        <div>
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Date range (ET)</span>
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            value={preset}
            onChange={(e) => {
              const v = e.target.value as DatePreset;
              if (v === "custom") {
                setPreset("custom");
                return;
              }
              applyPreset(v as Exclude<DatePreset, "custom">);
            }}
          >
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="ytd">Year to date</option>
            <option value="custom">Custom range</option>
          </select>
        </div>

        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <span className="mb-1 block text-[12px] text-muted-foreground">From (ET)</span>
              <DateInput
                className="h-10 w-[11rem]"
                value={customFrom}
                onValueChange={setCustomFrom}
                emptyHint={null}
              />
            </div>
            <div>
              <span className="mb-1 block text-[12px] text-muted-foreground">To (ET)</span>
              <DateInput className="h-10 w-[11rem]" value={customTo} onValueChange={setCustomTo} emptyHint={null} />
            </div>
            <Button type="button" size="sm" className="h-10" onClick={applyCustomDates}>
              Apply range
            </Button>
          </div>
        ) : (
          <p className="pb-2 text-[12px] tabular-nums text-muted-foreground">
            {from} → {to} (ET)
          </p>
        )}

        <Popover>
          <PopoverTrigger type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10")}>
            Entity ({entityKeys.size})
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <p className="mb-2 text-[12px] font-medium text-foreground">Entity scope</p>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {FACILITY_AUDIT_ENTITY_OPTIONS.map((opt) => (
                <label key={opt.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={entityKeys.has(opt.key)}
                    disabled={opt.tables.length === 0}
                    onChange={() => {
                      setEntityKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(opt.key)) next.delete(opt.key);
                        else next.add(opt.key);
                        if (next.size === 0) return ENTITY_ALL;
                        return next;
                      });
                    }}
                  />
                  <span className={opt.tables.length === 0 ? "text-muted-foreground" : undefined}>
                    {opt.label}
                    {opt.tables.length === 0 ? " — scaffold" : ""}
                  </span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10")}>
            Action ({actionKeys.size})
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            {FACILITY_AUDIT_ACTION_UI.map((a) => (
              <label key={a.key} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={actionKeys.has(a.key)}
                  onChange={() => {
                    setActionKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.key)) next.delete(a.key);
                      else next.add(a.key);
                      if (next.size === 0) return new Set(DEFAULT_ACTION_KEYS);
                      return next;
                    });
                  }}
                />
                {a.label}
              </label>
            ))}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Exported / viewed / IAM verbs wait on hardened audit spine.
            </p>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10")}>
            Users ({actorSubset == null ? "all" : actorSubset.length})
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-foreground">Actors</span>
              <button
                type="button"
                className="text-[11px] text-primary underline-offset-4 hover:underline"
                onClick={() => setActorSubset(null)}
              >
                All users with rows
              </button>
            </div>
            {participants.length === 0 ? (
              <p className="text-xs text-muted-foreground">No JWT-attributed editors in-range yet.</p>
            ) : (
              participants.map((p) => (
                <label key={p.id} className="flex items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={actorSubset != null && actorSubset.includes(p.id)}
                    onChange={() => toggleParticipant(p.id)}
                  />
                  <span>{p.label}</span>
                </label>
              ))
            )}
          </PopoverContent>
        </Popover>

        <div>
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Source</span>
          <select
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value as FacilityAuditSourceFilter)}
          >
            {FACILITY_AUDIT_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Saved views</span>
          <select
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            value={savedView}
            onChange={(e) => applySavedView(e.target.value)}
          >
            <option value="all">Everything</option>
            <option value="license">License changes only</option>
            <option value="documents">Document uploads</option>
            <option value="vendors">Vendor edits</option>
            <option value="rates">Rate changes</option>
            <option value="deletes">All deletes</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" className="h-10 gap-2" onClick={resetFilters}>
            <Filter className="size-4" aria-hidden />
            Filters{filterCount > 0 ? ` (${filterCount})` : ""}
          </Button>
          {filtersActive ? (
            <button
              type="button"
              className="text-[12px] text-primary underline-offset-4 hover:underline"
              onClick={() => resetFilters()}
            >
              Reset
            </button>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-10 gap-2"
          disabled={total === 0}
          onClick={() => void exportCsv()}
        >
          <Download className="size-4" aria-hidden />
          {filtersActive ? `Export filtered view (${Math.min(total, 5000)})` : `Export all (${Math.min(total, 5000)})`}
        </Button>
      </div>

      <p className="text-[13px] text-muted-foreground">{summaryLine}</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <>
          <div className="border-t border-border" />
          <div className="space-y-3 py-6">
            {filtersActive ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                No audit events match the current filters.{" "}
                <button type="button" className="text-primary underline underline-offset-4 hover:underline" onClick={resetFilters}>
                  Clear filters
                </button>
              </p>
            ) : !filtersActive && total === 0 && (metricsSummary?.events_all_time ?? 0) > 0 ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                No audit events fall in this date range, but older facility events exist. Widen the range (try{" "}
                <button type="button" className="text-primary underline underline-offset-4 hover:underline" onClick={() => applyPreset("90d")}>
                  Last 90 days
                </button>{" "}
                or{" "}
                <button type="button" className="text-primary underline underline-offset-4 hover:underline" onClick={() => applyPreset("ytd")}>
                  Year to date
                </button>
                ) to pull them forward.
              </p>
            ) : showSetupWarning ? (
              <>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  No audit events recorded yet for this facility. As changes are made, they will appear here with a
                  timestamp and user attribution when audit writes succeed.
                </p>
                <p className="max-w-2xl text-sm leading-relaxed text-amber-800 dark:text-amber-200">
                  ⚠ Note — this facility has had recent activity that should appear here. If you expect events and see
                  none, contact support with{" "}
                  <span className="font-mono text-xs text-foreground">FACILITY-AUDIT-LOG-INFRASTRUCTURE-INVESTIGATION.md</span>{" "}
                  attached, or ask engineering to replay migration{" "}
                  <span className="font-mono text-xs text-foreground">252_facility_audit_log_trigger_null_actor</span> and
                  confirm triggers on the target database.
                </p>
              </>
            ) : (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                No audit events recorded yet for this facility in this window. As changes are made, they will appear here
                with timestamp and user attribution when the audit spine is healthy.
              </p>
            )}

            <div>
              <p className="text-sm font-semibold tracking-normal text-foreground">Events captured include:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                {FACILITY_AUDIT_CAPTURE_BUCKETS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-border" />
        </>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full caption-bottom text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Timestamp</th>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-left font-medium">Summary</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const expandedRow = expanded === entry.id;
                const link = buildFacilityAuditEntityHref(facilityId, entry.table_name);
                return (
                  <React.Fragment key={entry.id}>
                    <tr
                      className="h-10 cursor-pointer border-t border-border/80 hover:bg-muted/30"
                      onClick={() => setExpanded(expandedRow ? null : entry.id)}
                    >
                      <td className="px-3 py-1.5 align-middle tabular-nums">
                        {new Date(entry.timestamp).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-1.5 align-middle text-foreground" title={entry.changed_by_display}>
                        {entry.changed_by_display}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal",
                            actionChipCls(entry.action),
                          )}
                        >
                          {entry.action === "INSERT" ? "Created" : entry.action === "DELETE" ? "Deleted" : "Updated"}
                        </span>
                      </td>
                      <td className="max-w-[12rem] px-3 py-1.5 align-middle">
                        {link ? (
                          <Link href={link.href} className="truncate text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            {link.label}
                          </Link>
                        ) : (
                          <span className="truncate text-muted-foreground">{entry.table_name.replace(/_/g, " ")}</span>
                        )}
                      </td>
                      <td className="min-w-[12rem] px-3 py-1.5 align-middle">{entry.summary}</td>
                      <td className="px-3 py-1.5 align-middle text-muted-foreground">{sourceHint(entry)}</td>
                    </tr>
                    {expandedRow ? (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-4 pb-4 pt-2 text-[12px] leading-relaxed text-foreground">
                          <p className="font-semibold tracking-normal text-foreground">Diff preview</p>
                          <p className="mt-2 text-muted-foreground">
                            record id <span className="tabular-nums text-foreground">{entry.record_id}</span>
                          </p>
                          {entry.field_name ? (
                            <p className="mt-3 text-muted-foreground">
                              <span className="mr-2 font-medium text-foreground">{entry.field_name}:</span>
                              <span className="text-destructive line-through">{formatAuditTabOldValue(entry.old_value_text)}</span> →{" "}
                              <strong className="font-semibold text-foreground">{formatAuditTabNewValue(entry.new_value_text)}</strong>
                            </p>
                          ) : (
                            <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-relaxed">
                              {prettyPayload(entry)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PER_PAGE ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <span className="tabular-nums">{total} total events · page size {PER_PAGE}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => void reload(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <span className="tabular-nums text-foreground">Page {page}</span>
            <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => void reload(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function prettyPayload(entry: FacilityAuditHookRow): string {
  const insertOrDelete =
    entry.action === "INSERT"
      ? { new: entry.new_value }
      : entry.action === "DELETE"
        ? { old: entry.old_value }
        : { old: entry.old_value, new: entry.new_value };
  try {
    return JSON.stringify(insertOrDelete, null, 2);
  } catch {
    return String(insertOrDelete);
  }
}

function sourceHint(entry: FacilityAuditHookRow): string {
  if (entry.user_agent && String(entry.user_agent).toLowerCase().includes("mob")) return "Mobile (guess)";
  if (!entry.user) return "Service session";
  return "Web app";
}
