"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall } from "lucide-react";
import { toast } from "sonner";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminOperationalListPanel,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { KpiCard, type KpiCardTone } from "@/components/ui/kpi-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  fetchResidentsFromSupabase,
  type Acuity,
  type AdlStatus,
  type ResidencyStatus,
  type ResidentRow,
} from "@/lib/residents/load-residents";
import {
  residentRosterCarePlanReviewsEmptyCopy,
  residentRosterKpiStripHelperLine,
  residentRosterOpenBedsEmptyCopy,
  rosterOpenBedsLoadedFootnote,
} from "@/lib/residents/resident-roster-kpi-copy";
import type { ResidentRosterMetrics } from "@/lib/residents/resident-roster-metrics";
import { presenceLabel, presenceTone } from "@/lib/residents/presence";
import {
  averageAcuity,
  formatResidentRosterAcuityCell,
  formatResidentRosterAcuityExport,
  formatResidentRosterAdlCell,
  formatResidentRosterAdlExport,
  formatResidentRosterUpdatedAt,
  rosterAvatarAccentFromId,
  truncateCareNoteSubtitle,
} from "@/lib/residents/roster-format";
import { RESIDENT_ROSTER_NO_ACUITY_COPY } from "@/lib/residents/roster-display-copy";
import { cn } from "@/lib/utils";

const DEFAULT_FILTERS = {
  search: "",
  acuity: "all",
  unit: "all",
  adl: "all",
  status: "all",
};

const GROUP_BY_STORAGE_KEY = "haven.residentRoster.groupBy.v1";
const COLLAPSED_STORAGE_KEY = "haven.residentRoster.collapsedGroups.v1";

export type ResidentRosterGroupBy = "unit" | "acuity" | "status" | "none";

type SortKey = "resident" | "location" | "acuity" | "updated";
type SortDir = "asc" | "desc";

type AdminResidentsPageClientProps = {
  initialRows: ResidentRow[];
  initialError: string | null;
  initialFacilityId: string | null;
  initialMetrics: ResidentRosterMetrics | null;
  /** Deep link target for resident records (admin vs clinical alias). */
  detailBaseHref: string;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function readGroupByStorage(): ResidentRosterGroupBy {
  if (typeof window === "undefined") return "unit";
  try {
    const raw = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
    if (raw === "unit" || raw === "acuity" || raw === "status" || raw === "none") return raw;
  } catch {
    /* ignore */
  }
  return "unit";
}

function readCollapsedStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function groupLabelForRow(mode: ResidentRosterGroupBy, row: ResidentRow): string {
  if (mode === "unit") return row.unit.trim().length > 0 ? row.unit : "No unit on file";
  if (mode === "acuity") {
    if (row.acuityLevel == null || row.acuityLevel.trim().length === 0) {
      return RESIDENT_ROSTER_NO_ACUITY_COPY;
    }
    return `Acuity ${row.acuity}`;
  }
  if (mode === "status") return presenceLabel(row.status);
  return "";
}

function sortRows(rows: ResidentRow[], sortKey: SortKey, dir: SortDir): ResidentRow[] {
  const sorted = [...rows];
  const m = dir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "resident":
        return m * collator.compare(a.name, b.name);
      case "location":
        return (
          m * collator.compare(a.unit || "\uFFFF", b.unit || "\uFFFF") ||
          m * collator.compare(a.room, b.room)
        );
      case "acuity":
        return m * (a.acuity - b.acuity);
      case "updated": {
        const ta = a.updatedAtIso ? new Date(a.updatedAtIso).getTime() : 0;
        const tb = b.updatedAtIso ? new Date(b.updatedAtIso).getTime() : 0;
        return m * (ta - tb);
      }
      default:
        return 0;
    }
  });
  return sorted;
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildResidentsCsv(rows: ResidentRow[]): string {
  const header = [
    "id",
    "name",
    "room",
    "unit",
    "acuity",
    "adl",
    "residency_status",
    "profile_updated_at",
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.name,
      r.room,
      r.unit,
      formatResidentRosterAcuityExport(r.acuityLevel, r.acuity),
      formatResidentRosterAdlExport(r.acuityLevel, r.adlStatus),
      r.status,
      r.updatedAtIso ?? "",
    ].map((c) => escapeCsvField(c)),
  );
  return ["\ufeff", header.join(","), ...lines.map((x) => x.join(","))].join("\r\n");
}

function AcuityCell({ acuityLevel, acuity }: { acuityLevel: string | null; acuity: Acuity }) {
  const cell = formatResidentRosterAcuityCell(acuityLevel, acuity);
  if (cell.tone === "gap") {
    return <span className="text-muted-foreground">{cell.label}</span>;
  }
  return <StatusPill tone={cell.tone}>{cell.label}</StatusPill>;
}

function AdlCell({ acuityLevel, status }: { acuityLevel: string | null; status: AdlStatus }) {
  const cell = formatResidentRosterAdlCell(acuityLevel, status);
  if (cell.tone === "gap") {
    return <span className="text-muted-foreground">{cell.label}</span>;
  }
  return <StatusPill tone={cell.tone}>{cell.label}</StatusPill>;
}

function ResidentStatusCell({ status }: { status: ResidencyStatus }) {
  // Show every presence state explicitly, including In-house. A Status column
  // full of em-dashes reads as "no data" when in fact everyone is in-house.
  // In-house uses the muted tone so away states (hospital / leave) still draw
  // the eye, but presence is always legible at a glance.
  return <StatusPill tone={presenceTone(status)}>{presenceLabel(status)}</StatusPill>;
}

export function AdminResidentsPageClient({
  initialRows,
  initialError,
  initialFacilityId,
  initialMetrics,
  detailBaseHref,
}: AdminResidentsPageClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ResidentRow[]>(initialRows);
  const [metrics, setMetrics] = useState<ResidentRosterMetrics | null>(initialMetrics);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const skipNextLoadRef = useRef(initialError == null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [acuity, setAcuity] = useState(DEFAULT_FILTERS.acuity);
  const [unit, setUnit] = useState(DEFAULT_FILTERS.unit);
  const [adl, setAdl] = useState(DEFAULT_FILTERS.adl);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);

  const [groupBy, setGroupBy] = useState<ResidentRosterGroupBy>("unit");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const s = searchParams.get("sort");
    if (s === "resident" || s === "location" || s === "acuity" || s === "updated") return s;
    return "location";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    searchParams.get("dir") === "desc" ? "desc" : "asc",
  );

  useEffect(() => {
    setGroupBy(readGroupByStorage());
    setCollapsedKeys(new Set(readCollapsedStorage()));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_BY_STORAGE_KEY, groupBy);
    } catch {
      /* ignore */
    }
  }, [groupBy]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsedKeys]));
    } catch {
      /* ignore */
    }
  }, [collapsedKeys]);

  useEffect(() => {
    const s = searchParams.get("sort");
    const dir = searchParams.get("dir") === "desc" ? "desc" : "asc";
    const nextSort: SortKey =
      s === "resident" || s === "location" || s === "acuity" || s === "updated" ? s : "location";
    setSortKey(nextSort);
    setSortDir(dir);
  }, [searchParams]);

  const loadResidents = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);

    try {
      const liveRows = await fetchResidentsFromSupabase(selectedFacilityId);
      setRows(liveRows);
      const { fetchResidentRosterMetrics } = await import("@/lib/residents/resident-roster-metrics");
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const nextMetrics = await fetchResidentRosterMetrics(selectedFacilityId, liveRows.length, supabase);
      setMetrics(nextMetrics);
    } catch (err) {
      setRows([]);
      setMetrics(null);
      setError(formatLiveDataLoadError(err, "Resident roster is unavailable right now."));
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);



  useEffect(() => {
    const requestedSearch = searchParams.get("search") ?? DEFAULT_FILTERS.search;
    const requestedAcuity = searchParams.get("acuity") ?? DEFAULT_FILTERS.acuity;
    const requestedUnit = searchParams.get("unit") ?? DEFAULT_FILTERS.unit;
    const requestedAdl = searchParams.get("adl") ?? DEFAULT_FILTERS.adl;
    const requestedStatus = searchParams.get("status") ?? DEFAULT_FILTERS.status;

    setSearch(requestedSearch);
    setAcuity(["all", "1", "2", "3", "watchlist"].includes(requestedAcuity) ? requestedAcuity : DEFAULT_FILTERS.acuity);
    setUnit(requestedUnit || DEFAULT_FILTERS.unit);
    setAdl(
      ["all", "independent", "assisted", "dependent"].includes(requestedAdl)
        ? requestedAdl
        : DEFAULT_FILTERS.adl,
    );
    setStatus(
      ["all", "active", "hospital", "loa", "away"].includes(requestedStatus)
        ? requestedStatus
        : DEFAULT_FILTERS.status,
    );
  }, [searchParams]);

  const applyResidentFilters = useCallback(
    (
      input: ResidentRow[],
      overrides?: Partial<{
        search: string;
        acuity: string;
        unit: string;
        adl: string;
        status: string;
      }>,
    ) => {
      const effectiveSearch = overrides?.search ?? search;
      const effectiveAcuity = overrides?.acuity ?? acuity;
      const effectiveUnit = overrides?.unit ?? unit;
      const effectiveAdl = overrides?.adl ?? adl;
      const effectiveStatus = overrides?.status ?? status;
      const loweredSearch = effectiveSearch.trim().toLowerCase();

      return input.filter((row) => {
        const matchesSearch =
          loweredSearch.length === 0 ||
          row.name.toLowerCase().includes(loweredSearch) ||
          row.room.toLowerCase().includes(loweredSearch) ||
          row.unit.toLowerCase().includes(loweredSearch);
        const matchesAcuity =
          effectiveAcuity === "all" ||
          (row.acuityLevel != null &&
            row.acuityLevel.trim().length > 0 &&
            (effectiveAcuity === "watchlist"
              ? row.acuity === 2 || row.acuity === 3
              : String(row.acuity) === effectiveAcuity));
        const matchesUnit =
          effectiveUnit === "all" ||
          (effectiveUnit === "__no_unit__" ? row.unit.trim().length === 0 : row.unit === effectiveUnit);
        const matchesAdl =
          effectiveAdl === "all" ||
          (row.acuityLevel != null &&
            row.acuityLevel.trim().length > 0 &&
            row.adlStatus === effectiveAdl);
        const matchesStatus =
          effectiveStatus === "all" ||
          (effectiveStatus === "away" ? row.status === "hospital" || row.status === "loa" : row.status === effectiveStatus);

        return matchesSearch && matchesAcuity && matchesUnit && matchesAdl && matchesStatus;
      });
    },
    [search, acuity, unit, adl, status],
  );

  const filteredRows = useMemo(() => applyResidentFilters(rows), [applyResidentFilters, rows]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      const ok = new Set(sortedRows.map((r) => r.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (ok.has(id)) next.add(id);
      }
      return next;
    });
  }, [sortedRows]);

  const unitOptions = useMemo(() => {
    const distinctUnits = Array.from(
      new Set(
        rows
          .map((row) => row.unit.trim())
          .filter((u) => u.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return [
      { value: "all", label: "All units" },
      { value: "__no_unit__", label: "No unit on file" },
      ...distinctUnits.map((name) => ({ value: name, label: name })),
    ];
  }, [rows]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No residents in this scope",
          description:
            "Live resident roster returned no residents for the selected facility. Change facility scope or start a new admission from the pipeline.",
        },
        whenFiltersExcludeAll: {
          title: "No residents match the current filters",
          description:
            "Try broadening search, acuity, unit, ADL, or residency filters. Lists stay scoped by your facility selection.",
        },
      }),
    [rows.length],
  );

  const residentsInViewCount = filteredRows.length;
  const highAcuityInViewCount = filteredRows.filter((row) => row.acuity >= 3).length;
  let highAcuityTone: KpiCardTone = "neutral";
  if (highAcuityInViewCount >= 4) highAcuityTone = "danger";
  else if (highAcuityInViewCount >= 1) highAcuityTone = "warning";

  const openBedsEmptyCopy = residentRosterOpenBedsEmptyCopy(selectedFacilityId, metrics);
  const careReviewsEmptyCopy = residentRosterCarePlanReviewsEmptyCopy(selectedFacilityId, metrics);
  const openBedsLoaded = openBedsEmptyCopy == null && metrics?.openBeds != null;
  const careReviewsLoaded = careReviewsEmptyCopy == null && metrics?.carePlanReviewsDueWeek != null;
  const openBedsFootnote =
    openBedsLoaded && metrics != null ? rosterOpenBedsLoadedFootnote(metrics) : null;
  const kpiStripHelperLine = residentRosterKpiStripHelperLine(
    selectedFacilityId,
    openBedsLoaded,
    careReviewsLoaded,
  );

  // Presence breakdown of the residents in view — additive to census, computed
  // client-side from the rows already loaded (no extra query).
  const presenceInView = {
    inHouse: filteredRows.filter((row) => row.status === "active").length,
    hospital: filteredRows.filter((row) => row.status === "hospital").length,
    onLeave: filteredRows.filter((row) => row.status === "loa").length,
  };

  const grouped = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "_flat_", label: "", rows: sortedRows }];
    }
    const map = new Map<string, ResidentRow[]>();
    for (const row of sortedRows) {
      const label = groupLabelForRow(groupBy, row);
      const cur = map.get(label);
      if (cur) cur.push(row);
      else map.set(label, [row]);
    }
    const keys = Array.from(map.keys()).sort((a, b) => collator.compare(a, b));
    return keys.map((key) => ({ key: `grp:${groupBy}:${key}`, label: key, rows: map.get(key) ?? [] }));
  }, [groupBy, sortedRows]);

  const flatRowsForBulk = sortedRows;

  const selectAllChecked =
    flatRowsForBulk.length > 0 &&
    flatRowsForBulk.every((r) => selectedIds.has(r.id));
  const selectSome =
    flatRowsForBulk.some((r) => selectedIds.has(r.id)) && !selectAllChecked;

  useEffect(() => {
    const el = headerCheckboxRef.current;
    if (!el) return;
    el.indeterminate = selectSome;
  }, [selectAllChecked, selectSome, flatRowsForBulk.length]);

  const persistSortToUrl = useCallback(
    (nextSort: SortKey, nextDir: SortDir) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("sort", nextSort);
      params.set("dir", nextDir);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const toggleSort = (key: SortKey) => {
    if (!["resident", "location", "acuity", "updated"].includes(key)) return;
    if (sortKey === key) {
      const nd: SortDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nd);
      persistSortToUrl(key, nd);
    } else {
      setSortKey(key);
      const nd: SortDir = key === "updated" ? "desc" : "asc";
      setSortDir(nd);
      persistSortToUrl(key, nd);
    }
  };

  const toggleRowSelected = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const toggleSelectAllInView = () => {
    if (selectAllChecked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(flatRowsForBulk.map((r) => r.id)));
  };

  const exportSelectedCsv = () => {
    const chosen = flatRowsForBulk.filter((r) => selectedIds.has(r.id));
    if (chosen.length === 0) return;
    const csv = buildResidentsCsv(chosen);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resident-roster-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${chosen.length} residents (CSV).`);
  };

  const queueCarePlanReview = () => {
    const n = selectedIds.size;
    toast.message("Batch care plan review queue", {
      description:
        n > 0
          ? `${n} selected — confirm workflow routing with clinical ops before we wire this queue.`
          : "Select residents to stage a batch review.",
    });
  };

  const SortHeaderBtn = ({
    colKey,
    label,
    className,
    align,
    title,
  }: {
    colKey: SortKey | null;
    label: React.ReactNode;
    className?: string;
    align?: "left" | "right";
    title?: string;
  }) =>
    colKey ? (
      <button
        type="button"
        title={title}
        onClick={() => toggleSort(colKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-left font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "ml-auto",
          className,
        )}
      >
        <span>{label}</span>
        {sortKey === colKey ? <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    ) : (
      <span className={cn(align === "right" && "ml-auto")} title={title}>
        {label}
      </span>
    );

  const renderRowCells = (resident: ResidentRow) => {
    const rosterAccent = rosterAvatarAccentFromId(resident.id);
    return (
    <>
      <div className="flex-[3] flex min-w-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger>
            <span
              aria-hidden
              className="inline-flex size-[10px] shrink-0 cursor-default rounded-full ring-1 ring-border/70"
              style={{ backgroundColor: rosterAccent.foreground }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-sm text-[12px]">
            Identity marker — color distinguishes similar names.
          </TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-foreground underline-offset-4 group-hover:underline">
            {resident.name}
          </span>
          {resident.careSummary.trim().length > 0 ? (
            <span className="hidden truncate text-[11px] text-muted-foreground md:block" title={resident.careSummary}>
              {truncateCareNoteSubtitle(resident.careSummary, 60)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground">{resident.room}</span>
        {resident.unit.trim().length > 0 ? (
          <span className="truncate text-[11px] text-muted-foreground">{resident.unit}</span>
        ) : null}
      </div>

      <div className="flex-1">
        <AcuityCell acuityLevel={resident.acuityLevel} acuity={resident.acuity} />
      </div>

      <div className="flex-1">
        <AdlCell acuityLevel={resident.acuityLevel} status={resident.adlStatus} />
      </div>

      <div className="flex-1">
        <ResidentStatusCell status={resident.status} />
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger>
            <span className="cursor-default text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
              {formatResidentRosterUpdatedAt(resident.updatedAtIso)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-[12px]">
            Today this reflects the latest resident profile save time (database row save). Confirm the operator-facing
            lifecycle you want surfaced before renaming this column.
          </TooltipContent>
        </Tooltip>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </>
    );
  };

  const renderRow = (resident: ResidentRow) => (
    <TableRow
      key={resident.id}
      className="group px-2"
    >
      <label
        className="flex w-10 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted/40"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          className="size-3.5 rounded border border-input"
          aria-label={`Select ${resident.name}`}
          checked={selectedIds.has(resident.id)}
          onChange={(e) => toggleRowSelected(resident.id, e.target.checked)}
        />
      </label>
      <Link
        href={`${detailBaseHref}/${resident.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {renderRowCells(resident)}
      </Link>
    </TableRow>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Resident roster</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Census, acuity, and assignment signal for day-to-day clinical operators.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger>
              <Link
                href="/pipeline/admissions/new"
                className={cn(
                  buttonVariants({ size: "default" }),
                  "h-9 px-3 text-[12px] font-medium",
                )}
              >
                + New admission
              </Link>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-[12px]">Start a new admission case in the pipeline.</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          <KpiCard
            value={residentsInViewCount}
            label="Residents in view"
            tone="neutral"
            className="flex min-h-[118px] flex-col justify-between"
          />
          <KpiCard
            value={presenceInView.inHouse}
            label="In-house"
            tone="neutral"
            footnote={`Hospital ${presenceInView.hospital} · On leave ${presenceInView.onLeave}`}
            className="flex min-h-[118px] flex-col justify-between"
          />
          <KpiCard
            value={highAcuityInViewCount}
            label="High acuity in view (level 3+)"
            tone={highAcuityTone}
            className="flex min-h-[118px] flex-col justify-between"
          />
          <KpiCard
            value={openBedsEmptyCopy ?? metrics?.openBeds}
            valuePresentation={openBedsEmptyCopy != null ? "message" : "metric"}
            label="Open beds (licensed − occupied census)"
            tone="neutral"
            footnote={openBedsFootnote ?? undefined}
            className="flex min-h-[118px] flex-col justify-between"
          />
          <KpiCard
            value={careReviewsEmptyCopy ?? metrics?.carePlanReviewsDueWeek}
            valuePresentation={careReviewsEmptyCopy != null ? "message" : "metric"}
            label="Care plan reviews due (7 days)"
            tone={
              careReviewsEmptyCopy == null && metrics?.carePlanReviewsDueWeek != null && metrics.carePlanReviewsDueWeek > 0
                ? "warning"
                : "neutral"
            }
            footnote={
              careReviewsLoaded
                ? "Active / under-review plans with review due in the next week"
                : undefined
            }
            className="flex min-h-[118px] flex-col justify-between"
          />
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{kpiStripHelperLine}</p>
      </div>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search resident, room, or unit…"
        suppressResetUnlessDirty
        onSearchChange={setSearch}
        trailingSlot={
          <div className="flex items-center gap-1.5">
            <span className="hidden text-[12px] text-muted-foreground sm:inline">Group by</span>
            <Select
              value={groupBy}
              onValueChange={(v) =>
                setGroupBy(
                  v === "acuity" || v === "status" || v === "none" || v === "unit" ? v : "unit",
                )
              }
            >
              <SelectTrigger className="h-8 w-[min(100vw-2rem,176px)] min-w-[136px] rounded-md border border-input bg-card px-3 text-[13px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unit">Unit</SelectItem>
                <SelectItem value="acuity">Acuity</SelectItem>
                <SelectItem value="status">Residency status</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        filters={[
          {
            id: "acuity",
            compactLabel: "Acuity",
            value: acuity,
            onChange: setAcuity,
            options: [
              { value: "all", label: `All acuity levels (${applyResidentFilters(rows, { acuity: "all" }).length})` },
              { value: "watchlist", label: `Watchlist (levels 2–3) (${applyResidentFilters(rows, { acuity: "watchlist" }).length})` },
              { value: "1", label: `Level 1 (${applyResidentFilters(rows, { acuity: "1" }).length})` },
              { value: "2", label: `Level 2 (${applyResidentFilters(rows, { acuity: "2" }).length})` },
              { value: "3", label: `Level 3 (${applyResidentFilters(rows, { acuity: "3" }).length})` },
            ],
          },
          {
            id: "unit",
            compactLabel: "Unit",
            value: unit,
            onChange: setUnit,
            options: unitOptions.map((option) => ({
              value: option.value,
              label: `${option.label} (${applyResidentFilters(rows, { unit: option.value }).length})`,
            })),
          },
          {
            id: "adl",
            compactLabel: "ADL",
            value: adl,
            onChange: setAdl,
            options: [
              { value: "all", label: `All ADL statuses (${applyResidentFilters(rows, { adl: "all" }).length})` },
              {
                value: "independent",
                label: `Independent (${applyResidentFilters(rows, { adl: "independent" }).length})`,
                shortLabel: "Independent",
              },
              {
                value: "assisted",
                label: `Partial assist (${applyResidentFilters(rows, { adl: "assisted" }).length})`,
                shortLabel: "Partial assist",
              },
              {
                value: "dependent",
                label: `Total assist (${applyResidentFilters(rows, { adl: "dependent" }).length})`,
                shortLabel: "Total assist",
              },
            ],
          },
          {
            id: "status",
            compactLabel: "Residency",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: `All residency statuses (${applyResidentFilters(rows, { status: "all" }).length})` },
              {
                value: "active",
                label: `${presenceLabel("active")} (${applyResidentFilters(rows, { status: "active" }).length})`,
                shortLabel: presenceLabel("active"),
              },
              {
                value: "hospital",
                label: `${presenceLabel("hospital")} (${applyResidentFilters(rows, { status: "hospital" }).length})`,
                shortLabel: "Hospital",
              },
              {
                value: "loa",
                label: `${presenceLabel("loa")} (${applyResidentFilters(rows, { status: "loa" }).length})`,
                shortLabel: "On leave",
              },
              {
                value: "away",
                label: `Hospital or leave (${applyResidentFilters(rows, { status: "away" }).length})`,
                shortLabel: "Away",
              },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setAcuity(DEFAULT_FILTERS.acuity);
          setUnit(DEFAULT_FILTERS.unit);
          setAdl(DEFAULT_FILTERS.adl);
          setStatus(DEFAULT_FILTERS.status);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadResidents()} />
      ) : null}
      {!isLoading && !error && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && !error && filteredRows.length > 0 ? (
        <AdminOperationalListPanel>
          <TableRowHeader className="hidden px-2 text-[11px] font-semibold lg:flex normal-case tracking-tight">
            <div className="flex w-10 shrink-0 items-center justify-center">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                aria-label="Select all residents in view"
                checked={selectAllChecked}
                onChange={toggleSelectAllInView}
                className="size-3.5 rounded border border-input"
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex-[3]">
                <SortHeaderBtn colKey="resident" label="Resident" />
              </div>
              <div className="flex-1">
                <SortHeaderBtn colKey="location" label="Location" />
              </div>
              <div className="flex-1">
                <SortHeaderBtn colKey="acuity" label="Acuity" />
              </div>
              <div className="flex-1">
                <SortHeaderBtn colKey={null} label="ADL" />
              </div>
              <div className="flex-1">
                <SortHeaderBtn colKey={null} label="Status" />
              </div>
              <div className="flex flex-1 justify-end gap-2 text-right">
                <SortHeaderBtn
                  colKey="updated"
                  label="Updated"
                  align="right"
                  title="Sort by last profile save timestamp. Confirm the operator-facing lifecycle before renaming."
                />
              </div>
            </div>
          </TableRowHeader>
          <div className="space-y-4 p-1">
            {grouped.map((group) =>
              groupBy === "none" ? (
                <div key={group.key} className="space-y-1">
                  {group.rows.map((resident) => (
                    <div key={resident.id}>{renderRow(resident)}</div>
                  ))}
                </div>
              ) : (
                <div key={group.key} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      const k = group.key;
                      setCollapsedKeys((prev) => {
                        const n = new Set(prev);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-[13px] py-2 text-left text-[12px]"
                  >
                    {collapsedKeys.has(group.key) ? (
                      <ChevronRightSmall className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 font-medium text-foreground">
                      <span>{group.label}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {group.rows.length} residents · avg acuity {averageAcuity(group.rows)}
                      </span>
                    </span>
                  </button>
                  {!collapsedKeys.has(group.key) ? (
                    <div className="space-y-1">{group.rows.map((resident) => renderRow(resident))}</div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        </AdminOperationalListPanel>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl ring-1 ring-border/60">
            <p className="min-w-0 flex-1 text-[13px] text-foreground">
              <strong className="tabular-nums">{selectedIds.size}</strong> resident{selectedIds.size === 1 ? "" : "s"} selected
            </p>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-[12px]" onClick={exportSelectedCsv}>
              Export selected (CSV)
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-[12px]" onClick={queueCarePlanReview}>
              Send to care plan review queue
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-[12px] text-muted-foreground"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
