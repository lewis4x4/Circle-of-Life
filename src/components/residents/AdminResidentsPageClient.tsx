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
} from "@/components/common/admin-list-patterns";
import { NamedAdminRouteLoading } from "@/components/layout/named-admin-route-loading";
import { ChangeBedAction } from "@/components/residents/ChangeBedAction";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";
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
} from "@/lib/residents/resident-roster-kpi-copy";
import type { ResidentRosterMetrics } from "@/lib/residents/resident-roster-metrics";
import {
  acuityCoverage,
  CARE_PLAN_REVIEWS_LABEL,
  carePlanFigure,
  effectiveRosterGroupBy,
  highAcuityFigure,
  presenceBreakdown,
  presenceLine,
  rosterShowingCopy,
  type ResidentRosterGroupBy,
  type SummaryFigure,
  UNOCCUPIED_BEDS_LABEL,
  unoccupiedBedsFigure,
} from "@/lib/residents/resident-roster-summary";
import { presenceLabel, presenceTone } from "@/lib/residents/presence";
import {
  averageAcuity,
  formatResidentRosterAcuityCell,
  formatResidentRosterAcuityExport,
  formatResidentRosterAdlCell,
  formatResidentRosterAdlExport,
  formatResidentRosterUpdatedAt,
  truncateCareNoteSubtitle,
} from "@/lib/residents/roster-format";
import { RESIDENT_ROSTER_NO_ACUITY_COPY, RESIDENT_ROSTER_NO_ADL_COPY } from "@/lib/residents/roster-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
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

export type { ResidentRosterGroupBy };

/** Filter value for "this record has no posted acuity / ADL" — the missing-data view. */
const NOT_POSTED_FILTER = "not_posted";

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

const summaryToneClass: Record<SummaryFigure["tone"], string> = {
  neutral: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

/**
 * One cell of the compact facility summary strip. Renders the figure's honest
 * headline (a number, or "Not established") over the inputs that produced it.
 * When the figure did not load, the cell says what is missing instead.
 */
function SummaryCell({
  label,
  figure,
  emptyCopy,
  action,
}: {
  label: string;
  figure: SummaryFigure | null;
  emptyCopy?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[72px] flex-col justify-between gap-1 bg-card px-4 py-2.5">
      <dt className="text-[12px] leading-snug text-muted-foreground">{label}</dt>
      <dd className="m-0 flex flex-col gap-0.5">
        {figure ? (
          <>
            <span className={cn("text-[20px] font-semibold leading-tight tabular-nums", summaryToneClass[figure.tone])}>
              {figure.headline}
            </span>
            <span className="text-[12px] leading-snug text-muted-foreground">{figure.detail}</span>
          </>
        ) : (
          <span className="text-[13px] font-medium leading-snug text-muted-foreground">
            {emptyCopy ?? "Not loaded"}
          </span>
        )}
        {action ? <span className="mt-0.5">{action}</span> : null}
      </dd>
    </div>
  );
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
  const loadSequenceRef = useRef(0);

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

    // Reads overlap when the facility store hydrates just after the mount
    // load starts; only the most recent read may write state, or an earlier
    // unscoped read lands last and blanks the facility figures (observed
    // 2026-09-15: "Licensed beds not on file" under Homewood Lodge).
    const sequence = ++loadSequenceRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const liveRows = await fetchResidentsFromSupabase(selectedFacilityId);
      const { fetchResidentRosterMetrics } = await import("@/lib/residents/resident-roster-metrics");
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const nextMetrics = await fetchResidentRosterMetrics(
        selectedFacilityId,
        liveRows.map((row) => row.id),
        supabase,
      );
      if (sequence !== loadSequenceRef.current) return;
      setRows(liveRows);
      setMetrics(nextMetrics);
    } catch (err) {
      if (sequence !== loadSequenceRef.current) return;
      setRows([]);
      setMetrics(null);
      setError(formatLiveDataLoadError(err, "Resident roster is unavailable right now."));
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  // The server renders the roster for the facility named by the scope cookie;
  // the header selector reads browser storage. Pages that write the selector
  // without the cookie (Stand Up, working-facility pickers) leave the two
  // apart, and the shell only rewrites the cookie — it does not refresh. Every
  // sibling hub reloads on mount when the store disagrees with the server's
  // scope; the roster must too, or it shows one facility's census under
  // another facility's name.
  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);


  useEffect(() => {
    const requestedSearch = searchParams.get("search") ?? DEFAULT_FILTERS.search;
    const requestedAcuity = searchParams.get("acuity") ?? DEFAULT_FILTERS.acuity;
    const requestedUnit = searchParams.get("unit") ?? DEFAULT_FILTERS.unit;
    const requestedAdl = searchParams.get("adl") ?? DEFAULT_FILTERS.adl;
    const requestedStatus = searchParams.get("status") ?? DEFAULT_FILTERS.status;

    setSearch(requestedSearch);
    setAcuity(
      ["all", "1", "2", "3", "watchlist", NOT_POSTED_FILTER].includes(requestedAcuity)
        ? requestedAcuity
        : DEFAULT_FILTERS.acuity,
    );
    setUnit(requestedUnit || DEFAULT_FILTERS.unit);
    setAdl(
      ["all", "independent", "assisted", "dependent", NOT_POSTED_FILTER].includes(requestedAdl)
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
        const acuityPosted = row.acuityLevel != null && row.acuityLevel.trim().length > 0;
        const matchesAcuity =
          effectiveAcuity === "all" ||
          (effectiveAcuity === NOT_POSTED_FILTER
            ? !acuityPosted
            : acuityPosted &&
              (effectiveAcuity === "watchlist"
                ? row.acuity === 2 || row.acuity === 3
                : String(row.acuity) === effectiveAcuity));
        const matchesUnit =
          effectiveUnit === "all" ||
          (effectiveUnit === "__no_unit__" ? row.unit.trim().length === 0 : row.unit === effectiveUnit);
        // ADL support is derived from posted acuity, so "not posted" is the same population.
        const matchesAdl =
          effectiveAdl === "all" ||
          (effectiveAdl === NOT_POSTED_FILTER ? !acuityPosted : acuityPosted && row.adlStatus === effectiveAdl);
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
            "Live resident roster returned no residents in this scope. Change facility scope or start a new admission from the pipeline.",
        },
        whenFiltersExcludeAll: {
          title: "No residents match the current filters",
          description:
            "Try broadening search, acuity, unit, ADL, or residency filters. Lists stay scoped by your facility selection.",
        },
      }),
    [rows.length],
  );

  // Facility-wide figures come from the complete scoped roster (`rows`), never
  // from the filtered rows on screen. The filtered population is stated once,
  // beside the table, as "Showing X of N".
  const facilityPresence = presenceBreakdown(rows);
  const coverage = acuityCoverage(rows);
  const highAcuity = highAcuityFigure(coverage);
  const residentsWithoutPostedAcuity = coverage.total - coverage.assessed;
  const unoccupiedBeds = unoccupiedBedsFigure(metrics);
  const carePlans = carePlanFigure(metrics?.carePlanCoverage ?? null);
  const showingCopy = rosterShowingCopy(filteredRows.length, rows.length);

  const openBedsEmptyCopy = residentRosterOpenBedsEmptyCopy(selectedFacilityId, metrics);
  const careReviewsEmptyCopy = residentRosterCarePlanReviewsEmptyCopy(selectedFacilityId, metrics);
  const kpiStripHelperLine = residentRosterKpiStripHelperLine(
    selectedFacilityId,
    unoccupiedBeds != null,
    carePlans != null,
  );

  const grouping = useMemo(() => effectiveRosterGroupBy(groupBy, rows), [groupBy, rows]);
  const effectiveGroupBy = grouping.groupBy;

  const grouped = useMemo(() => {
    if (effectiveGroupBy === "none") {
      return [{ key: "_flat_", label: "", rows: sortedRows }];
    }
    const map = new Map<string, ResidentRow[]>();
    for (const row of sortedRows) {
      const label = groupLabelForRow(effectiveGroupBy, row);
      const cur = map.get(label);
      if (cur) cur.push(row);
      else map.set(label, [row]);
    }
    const keys = Array.from(map.keys()).sort((a, b) => collator.compare(a, b));
    return keys.map((key) => ({ key: `grp:${effectiveGroupBy}:${key}`, label: key, rows: map.get(key) ?? [] }));
  }, [effectiveGroupBy, sortedRows]);

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

  const ariaSortFor = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

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

  const residentToMove = selectedIds.size === 1 ? flatRowsForBulk.find((row) => selectedIds.has(row.id)) : null;

  const exportSelectedCsv = () => {
    const chosen = flatRowsForBulk.filter((r) => selectedIds.has(r.id));
    if (chosen.length === 0) return;
    const csv = buildResidentsCsv(chosen);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resident-roster-${todayFacilityDateIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${chosen.length} residents (CSV).`);
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

  // Columns: Resident · Room · Acuity · ADL support · Presence · Profile updated.
  // No identity dot beside the name — an unexplained color next to a resident
  // reads as a clinical status. Acuity and ADL yield to name / room / presence
  // below `md`; the row stays a single line at every width.
  // Flat, conventional rows: a hairline between rows instead of a rounded
  // border around each one, and no hover lift. The 36px height, hover
  // background, and focus ring from the primitive stay. Every cell carries
  // `role="cell"` so the row is a real ARIA row; the resident's name is the
  // link and it stretches over the row (`after:inset-0`), which keeps one tab
  // stop per row and lets the checkbox sit above it.
  const renderRow = (resident: ResidentRow) => (
    <TableRow
      key={resident.id}
      role="row"
      className="group relative rounded-none border-0 border-b border-border px-2 last:border-b-0 hover:translate-y-0 focus-within:bg-muted/40"
    >
      <div role="cell" className="relative z-10 flex w-10 shrink-0 items-center justify-center">
        <label className="flex cursor-pointer items-center justify-center rounded-md p-1 hover:bg-muted/40">
          <input
            type="checkbox"
            className="size-3.5 rounded border border-input"
            aria-label={`Select ${resident.name}`}
            checked={selectedIds.has(resident.id)}
            onChange={(e) => toggleRowSelected(resident.id, e.target.checked)}
          />
        </label>
      </div>

      <div role="cell" className="flex-[3] flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* No `truncate` on the link itself — overflow:hidden would clip the stretched ::after. */}
          <Link
            href={`${detailBaseHref}/${resident.id}`}
            className="block min-w-0 text-[13px] font-medium text-foreground underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:underline focus-visible:outline-none focus-visible:underline"
          >
            <span className="block truncate">{resident.name}</span>
          </Link>
          {resident.careSummary.trim().length > 0 ? (
            <span className="hidden truncate text-[11px] text-muted-foreground md:block" title={resident.careSummary}>
              {truncateCareNoteSubtitle(resident.careSummary, 60)}
            </span>
          ) : null}
        </div>
      </div>

      <div role="cell" className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium tabular-nums text-foreground">{resident.room}</span>
        {resident.unit.trim().length > 0 ? (
          <span className="truncate text-[11px] text-muted-foreground">{resident.unit}</span>
        ) : null}
      </div>

      <div role="cell" className="hidden flex-1 md:block">
        <AcuityCell acuityLevel={resident.acuityLevel} acuity={resident.acuity} />
      </div>

      <div role="cell" className="hidden flex-1 md:block">
        <AdlCell acuityLevel={resident.acuityLevel} status={resident.adlStatus} />
      </div>

      <div role="cell" className="flex-1">
        <ResidentStatusCell status={resident.status} />
      </div>

      <div role="cell" className="hidden flex-1 items-center justify-end gap-2 lg:flex">
        <span
          className="cursor-default text-[11px] tabular-nums text-muted-foreground whitespace-nowrap"
          title={`Profile updated ${resident.updatedAtIso ?? "— no date posted"} (last save of the resident record; not an assessment or presence check)`}
        >
          {formatResidentRosterUpdatedAt(resident.updatedAtIso)}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
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
          {/* The roster's claim to be right is a closed board check (COL-361). */}
          <Link
            href="/admin/residents/board-check"
            title="Walk the building with the physical census board and reconcile it against this roster, bed by bed."
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "h-9 px-3 text-[12px] font-medium",
            )}
          >
            Board check
          </Link>
          {/* The register is the paper admission and discharge log (COL-353). */}
          <Link
            href="/admin/residents/register"
            title="Every admission, discharge and bed hold Haven has recorded for this building, derived from resident status history."
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "h-9 px-3 text-[12px] font-medium",
            )}
          >
            Register
          </Link>
          <Link
            href="/pipeline/admissions/new"
            title="Start a new admission case in the pipeline — the intake form checks for an existing resident or inquiry before creating one."
            className={cn(
              buttonVariants({ size: "default" }),
              "h-9 px-3 text-[12px] font-medium",
            )}
          >
            + New admission
          </Link>
        </div>
      </div>

      <section aria-label="Facility summary" className="flex flex-col gap-2">
        <p className="text-[13px] text-foreground">
          <span className="font-medium">{presenceLine(facilityPresence)}</span>
          <span className="text-muted-foreground"> · facility-wide, not affected by filters</span>
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60">
          <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
            <SummaryCell
              label="High acuity (level 3)"
              figure={highAcuity}
              action={
                residentsWithoutPostedAcuity > 0 ? (
                  <button
                    type="button"
                    className="text-[12px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setAcuity(NOT_POSTED_FILTER)}
                  >
                    View {residentsWithoutPostedAcuity === 1 ? "the resident" : `${residentsWithoutPostedAcuity} residents`} without posted acuity
                  </button>
                ) : null
              }
            />
            <SummaryCell
              label={UNOCCUPIED_BEDS_LABEL}
              figure={unoccupiedBeds}
              emptyCopy={openBedsEmptyCopy}
            />
            <SummaryCell
              label={CARE_PLAN_REVIEWS_LABEL}
              figure={carePlans}
              emptyCopy={careReviewsEmptyCopy}
              action={
                <Link
                  href="/admin/care-plans/reviews-due"
                  className="text-[12px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open reviews due
                </Link>
              }
            />
          </dl>
        </div>
        {kpiStripHelperLine ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">{kpiStripHelperLine}</p>
        ) : null}
      </section>

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
              <SelectTrigger
                aria-label="Group by"
                className="h-8 w-[min(100vw-2rem,176px)] min-w-[136px] rounded-md border border-input bg-card px-3 text-[13px] shadow-none"
              >
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
              {
                value: NOT_POSTED_FILTER,
                label: `${RESIDENT_ROSTER_NO_ACUITY_COPY} (${applyResidentFilters(rows, { acuity: NOT_POSTED_FILTER }).length})`,
                shortLabel: RESIDENT_ROSTER_NO_ACUITY_COPY,
              },
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
              {
                value: NOT_POSTED_FILTER,
                label: `${RESIDENT_ROSTER_NO_ADL_COPY} (${applyResidentFilters(rows, { adl: NOT_POSTED_FILTER }).length})`,
                shortLabel: RESIDENT_ROSTER_NO_ADL_COPY,
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

      {isLoading ? <NamedAdminRouteLoading message={ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE} /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadResidents()} />
      ) : null}
      {!isLoading && !error && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && !error && filteredRows.length > 0 ? (
        <AdminOperationalListPanel
          toolbar={
            <>
              <p className="text-[12px] text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground">{showingCopy}</span>
                {grouping.notice ? <span> · {grouping.notice}</span> : null}
              </p>
            </>
          }
        >
          <div role="table" aria-label="Resident roster" aria-rowcount={filteredRows.length}>
          <div role="rowgroup">
          <TableRowHeader role="row" className="hidden px-2 text-[11px] font-semibold md:flex normal-case tracking-tight">
            <div role="columnheader" className="flex w-10 shrink-0 items-center justify-center">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                aria-label="Select all residents shown"
                checked={selectAllChecked}
                onChange={toggleSelectAllInView}
                className="size-3.5 rounded border border-input"
              />
            </div>
            <div role="columnheader" aria-sort={ariaSortFor("resident")} className="flex-[3]">
              <SortHeaderBtn colKey="resident" label="Resident" />
            </div>
            <div role="columnheader" aria-sort={ariaSortFor("location")} className="flex-1">
              <SortHeaderBtn colKey="location" label="Room" title="Sorted by unit, then room number (numeric)" />
            </div>
            <div role="columnheader" aria-sort={ariaSortFor("acuity")} className="flex-1">
              <SortHeaderBtn colKey="acuity" label="Acuity" />
            </div>
            <div role="columnheader" className="flex-1">
              <SortHeaderBtn
                colKey={null}
                label={
                  <>
                    <abbr title="Activities of daily living" className="no-underline">
                      ADL
                    </abbr>{" "}
                    support
                  </>
                }
                title="Activities of daily living — support level derived from posted acuity"
              />
            </div>
            <div role="columnheader" className="flex-1">
              <SortHeaderBtn colKey={null} label="Presence" />
            </div>
            <div role="columnheader" aria-sort={ariaSortFor("updated")} className="hidden flex-1 justify-end gap-2 text-right lg:flex">
              <SortHeaderBtn
                colKey="updated"
                label="Profile updated"
                align="right"
                title="Last save of the resident record. Not an assessment date or a presence check."
              />
            </div>
          </TableRowHeader>
          </div>
          <div className="flex flex-col">
            {grouped.map((group) =>
              effectiveGroupBy === "none" ? (
                <div key={group.key} role="rowgroup" className="flex flex-col">
                  {group.rows.map((resident) => renderRow(resident))}
                </div>
              ) : (
                <div key={group.key} role="rowgroup" className="flex flex-col">
                  <div role="row">
                  <div role="cell" className="flex w-full">
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
                    className="flex w-full items-center gap-2 border-b border-border bg-muted/40 px-[13px] py-2 text-left text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={!collapsedKeys.has(group.key)}
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
                        · {group.rows.length} {group.rows.length === 1 ? "resident" : "residents"}
                        {averageAcuity(group.rows) === RESIDENT_ROSTER_NO_ACUITY_COPY
                          ? " · no acuity posted"
                          : ` · avg acuity ${averageAcuity(group.rows)}`}
                      </span>
                    </span>
                  </button>
                  </div>
                  </div>
                  {!collapsedKeys.has(group.key) ? group.rows.map((resident) => renderRow(resident)) : null}
                </div>
              ),
            )}
          </div>
          </div>
        </AdminOperationalListPanel>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl ring-1 ring-border/60">
            <p className="min-w-0 flex-1 text-[13px] text-foreground">
              <strong className="tabular-nums">{selectedIds.size}</strong> resident{selectedIds.size === 1 ? "" : "s"} selected
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {residentToMove?.facilityId ? (
                <ChangeBedAction
                  key={residentToMove.id}
                  residentId={residentToMove.id}
                  residentName={residentToMove.name}
                  facilityId={residentToMove.facilityId}
                  currentBedLabel={residentToMove.room}
                  onDone={() => { setSelectedIds(new Set()); void loadResidents(); }}
                />
              ) : selectedIds.size > 1 ? (
                <span className="text-xs text-muted-foreground">Select one resident to change beds</span>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={exportSelectedCsv}>
                Export selected (CSV)
              </Button>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">Eastern (ET)</span>
            </div>
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
