"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ChevronRight, Download, Filter, HelpCircle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  endOfMonth,
  endOfQuarter,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
} from "date-fns";
import { AdminFilterBar, AdminOperationalListPanel, AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import {
  collectionRateSemanticClass,
  ninetyPlusRiskShareClass,
  outstandingArValueClass,
  overdueInvoicesValueClass,
  summarizeOpenArBucketTotals,
  totalOpenArCents,
} from "@/lib/billing/billing-ar-semantics";
import {
  billingActionQueueDraftCopy,
  billingActionQueueOverdueCopy,
  billingOverviewAppliedPeriodEmptyCopy,
  billingOverviewKpiStripHelperLine,
  billingOverviewNinetyPlusShareEmptyCopy,
  billingOverviewOutstandingArEmptyCopy,
  billingOverviewOverdueCountEmptyCopy,
  type BillingOverviewKpiContext,
} from "@/lib/billing/billing-overview-kpi-copy";
import {
  fetchInvoicesFromSupabase,
  fetchActiveResidentCountForBillingScope,
  type BillingRow,
  type InvoiceStatusUi,
  type PayerTypeUi,
} from "@/lib/billing/load-invoices";
import { collectionActivityHref, paymentHref } from "@/lib/billing/billing-links";

import { BILLING_AR_OVERVIEW_REFRESH } from "./billing-ar-overview-hero";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { QueryClientLayout } from "@/components/layout/query-client-layout";
import { cn } from "@/lib/utils";

export {
  mapDbInvoiceStatusToUi,
  mapDbPayerTypeToUi,
  type BillingRow,
  type InvoiceStatusUi,
  type PayerTypeUi,
} from "@/lib/billing/load-invoices";

const DEFAULT_FILTERS = {
  search: "",
  status: "all",
  payerType: "all",
};

const DEFAULT_HUB_LEDGER_PAGE_SIZE = 50;

type PeriodPreset =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "rolling_12"
  | "custom";

function periodBounds(preset: Exclude<PeriodPreset, "custom">, now = new Date()): { start: string; end: string } {
  switch (preset) {
    case "last_month": {
      const ref = subMonths(now, 1);
      return { start: format(startOfMonth(ref), "yyyy-MM-dd"), end: format(endOfMonth(ref), "yyyy-MM-dd") };
    }
    case "this_quarter":
      return { start: format(startOfQuarter(now), "yyyy-MM-dd"), end: format(endOfQuarter(now), "yyyy-MM-dd") };
    case "last_quarter": {
      const ref = subQuarters(now, 1);
      return { start: format(startOfQuarter(ref), "yyyy-MM-dd"), end: format(endOfQuarter(ref), "yyyy-MM-dd") };
    }
    case "ytd":
      return { start: format(startOfYear(now), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
    case "rolling_12":
      return { start: format(subDays(now, 364), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
    case "this_month":
    default:
      return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(endOfMonth(now), "yyyy-MM-dd") };
  }
}

function isoInPeriod(iso: string, bounds: { start: string; end: string }) {
  if (!iso) return false;
  return iso >= bounds.start && iso <= bounds.end;
}

const HUB_LEDGER_STATUS_CHIPS = ["all", "draft", "sent", "paid", "partial", "overdue", "void"] as const;

const OVERVIEW_PERIOD_FILTER_OPTIONS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "rolling_12", label: "Last 12 months" },
];

const INVOICES_HUB_PERIOD_FILTER_OPTIONS = [
  ...OVERVIEW_PERIOD_FILTER_OPTIONS,
  { value: "custom", label: "Custom range" },
];

function payerExportLabel(payerType: PayerTypeUi) {
  if (payerType === "private_pay") return "Private pay";
  if (payerType === "medicaid") return "Medicaid";
  return "LTC insurance";
}

function statusExportLabel(status: InvoiceStatusUi) {
  const map: Record<InvoiceStatusUi, string> = {
    draft: "Draft",
    sent: "Sent",
    partial: "Partial",
    paid: "Paid",
    overdue: "Overdue",
    void: "Voided",
    written_off: "Written off",
  };
  return map[status] ?? status;
}

function csvEscape(cell: string) {
  const safe = cell.replace(/"/g, '""');
  return `"${safe}"`;
}

function triggerBillingArRefresh() {
  window.dispatchEvent(new CustomEvent(BILLING_AR_OVERVIEW_REFRESH));
}

function slugifyPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "scope"
  );
}

function formatMonthSlugForExport(iso: string): string {
  const d = parseISO(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "period" : format(d, "MMMM-yyyy").toLowerCase();
}

function buildInvoiceCsvFilename(opts: {
  scopeLabel: string;
  period: { start: string; end: string };
  status: string;
}): string {
  const tail = opts.status !== "all" ? `_${slugifyPart(opts.status)}` : "";
  return `invoices-${slugifyPart(opts.scopeLabel)}-${formatMonthSlugForExport(opts.period.end)}_${opts.period.start}_to_${opts.period.end}${tail}.csv`;
}

function withSelectedInvoiceCsvSuffix(filename: string, selectedCount: number): string {
  return filename.replace(/\.csv$/i, `_selected-${selectedCount}.csv`);
}

function facilityBillingShortLabel(fullName: string): string {
  const t = fullName.replace(/\s+/g, " ").trim();
  if (!t) return "Facility";
  if (t.length <= 26) return t;
  return `${t.slice(0, 24)}…`;
}

function downloadInvoiceLedgerCsv(rows: BillingRow[], filename: string, facilityLookup: Map<string, string>) {
  const header = [
    "Invoice #",
    "Resident",
    "Facility",
    "Payer",
    "Billed ($)",
    "Outstanding ($)",
    "Status",
    "Invoice date",
    "Due date",
    "Facility id",
  ];
  const lines = rows.map((r) =>
    [
      csvEscape(r.invoiceNumber),
      csvEscape(r.residentName),
      csvEscape(facilityLookup.get(r.facilityId) ?? ""),
      csvEscape(payerExportLabel(r.payerType)),
      csvEscape(String(r.totalCents / 100)),
      csvEscape(String(r.amountDueCents / 100)),
      csvEscape(statusExportLabel(r.status)),
      csvEscape(r.invoiceDateIso),
      csvEscape(r.dueDateIso),
      csvEscape(r.facilityId),
    ].join(","),
  );

  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const billingCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export type BillingInvoiceLedgerProps = {
  title?: string;
  layout?: "overview" | "standard";
  /** Overview-only: cohort for $0 AR semantic (facility scope when set). */
  initialCohortResidentCount?: number;
  cardTitle?: string;
  cardDescription?: string;
  residentIdFilter?: string | null;
  initialRows?: BillingRow[];
  initialError?: string | null;
  initialFacilityId?: string | null;
};

type MetricLinkProps = {
  href: string;
  label: string;
  value: string;
  valueClassName: string;
  valuePresentation?: "metric" | "message";
  /** Optional clarification next to title (Quiet Operator KPIs). */
  labelTooltip?: string;
};

function MetricLinkTile({
  href,
  label,
  value,
  valueClassName,
  valuePresentation = "metric",
  labelTooltip,
}: MetricLinkProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-border bg-card text-center shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-colors hover:bg-accent/30",
      )}
    >
      <Link
        href={href}
        className="flex flex-col items-center rounded-xl px-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            valuePresentation === "message"
              ? "px-2 text-[13px] font-medium leading-snug"
              : "text-[28px] font-semibold tabular-nums leading-tight tracking-tight md:text-[28px]",
            valueClassName,
          )}
        >
          {value}
        </span>
        <span className="mt-2 max-w-[10rem] px-5 text-[13px] leading-snug text-muted-foreground">{label}</span>
      </Link>
      {labelTooltip ? (
        <div className="absolute right-1 top-1">
          <Tooltip>
            <TooltipTrigger
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`About ${label}`}
            >
              <HelpCircle className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[16rem] text-left text-xs leading-snug">
              {labelTooltip}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

function BillingInvoiceLedgerInner({
  title,
  layout = "standard",
  initialCohortResidentCount = 0,
  cardTitle = "Invoice ledger",
  cardDescription = "Open invoices and balances from the billing schema (RLS-scoped).",
  residentIdFilter = null,
  initialRows,
  initialError,
  initialFacilityId,
}: BillingInvoiceLedgerProps) {
  const isOverviewChrome = layout === "overview" && !residentIdFilter;
  const isInvoicesHub = layout === "standard" && !residentIdFilter;
  const searchParams = useSearchParams();

  const hasInitialLoad =
    initialRows !== undefined || initialError !== undefined || initialFacilityId !== undefined;
  const initialLoadSucceeded = hasInitialLoad && initialError == null;
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const facilityLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of availableFacilities) {
      m.set(f.id, f.name);
    }
    return m;
  }, [availableFacilities]);

  const facilityReady =
    selectedFacilityId == null || isValidFacilityIdForQuery(selectedFacilityId);

  const ssrScopeMatches =
    initialLoadSucceeded &&
    initialRows !== undefined &&
    selectedFacilityId === (initialFacilityId ?? null) &&
    (residentIdFilter ?? null) === null;

  const {
    data: rows = [],
    isPending,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["billing", "invoices", selectedFacilityId, residentIdFilter ?? null],
    enabled: facilityReady,
    queryFn: () => fetchInvoicesFromSupabase(selectedFacilityId, residentIdFilter),
    initialData: ssrScopeMatches ? initialRows : undefined,
    staleTime: ssrScopeMatches ? 60_000 : 0,
  });

  const isLoading = facilityReady && isPending && rows.length === 0;
  const error =
    facilityReady && queryError
      ? queryError instanceof Error
        ? queryError.message
        : "Failed to load data"
      : null;

  const [cohortCount, setCohortCount] = useState<number>(initialCohortResidentCount);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(() => {
    const st = searchParams.get("status");
    return st === "overdue" ? "overdue" : DEFAULT_FILTERS.status;
  });
  const [payerType, setPayerType] = useState(DEFAULT_FILTERS.payerType);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this_month");
  const [ledgerFacilityIds, setLedgerFacilityIds] = useState<string[] | null>(null);
  const [customPeriodFrom, setCustomPeriodFrom] = useState("");
  const [customPeriodTo, setCustomPeriodTo] = useState("");
  const [balanceDueOnly, setBalanceDueOnly] = useState(false);
  const [savedLedgerViewKey, setSavedLedgerViewKey] = useState("custom");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [invoiceHubPage, setInvoiceHubPage] = useState(1);
  const [hubPageSize, setHubPageSize] = useState(DEFAULT_HUB_LEDGER_PAGE_SIZE);
  const [hubLedgerSortDesc, setHubLedgerSortDesc] = useState(true);
  const [expandedHubRowId, setExpandedHubRowId] = useState<string | null>(null);
  const [hubSelectedIds, setHubSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkVoidDialogOpen, setBulkVoidDialogOpen] = useState(false);
  const [bulkPayDialogOpen, setBulkPayDialogOpen] = useState(false);
  const hubHeaderCheckboxRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const n = await fetchActiveResidentCountForBillingScope(selectedFacilityId);
      setCohortCount(n);
    })();
  }, [selectedFacilityId]);

  useEffect(() => {
    const onRefresh = () => {
      void refetch();
    };
    window.addEventListener(BILLING_AR_OVERVIEW_REFRESH, onRefresh);
    return () => window.removeEventListener(BILLING_AR_OVERVIEW_REFRESH, onRefresh);
  }, [refetch]);

  const period = useMemo(() => {
    if (periodPreset === "custom") {
      if (customPeriodFrom && customPeriodTo) {
        const lo = customPeriodFrom <= customPeriodTo ? customPeriodFrom : customPeriodTo;
        const hi = customPeriodFrom <= customPeriodTo ? customPeriodTo : customPeriodFrom;
        return { start: lo, end: hi };
      }
      return periodBounds("this_month");
    }
    return periodBounds(periodPreset);
  }, [periodPreset, customPeriodFrom, customPeriodTo]);

  const rowsMatchingPeriodAndFacilities = useMemo(() => {
    if (residentIdFilter) return rows;
    return rows.filter((row) => {
      if (!isoInPeriod(row.invoiceDateIso, period)) return false;
      const subsetActive =
        selectedFacilityId == null && ledgerFacilityIds != null && ledgerFacilityIds.length > 0;
      if (subsetActive && ledgerFacilityIds != null && !ledgerFacilityIds.includes(row.facilityId)) return false;
      return true;
    });
  }, [ledgerFacilityIds, period, residentIdFilter, rows, selectedFacilityId]);

  const pipelineRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rowsMatchingPeriodAndFacilities.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.invoiceNumber.toLowerCase().includes(loweredSearch) ||
        row.residentName.toLowerCase().includes(loweredSearch);
      const matchesPayerType = payerType === "all" || row.payerType === payerType;
      const balanceOk = !balanceDueOnly || row.amountDueCents > 0;
      return matchesSearch && matchesPayerType && balanceOk;
    });
  }, [balanceDueOnly, payerType, rowsMatchingPeriodAndFacilities, search]);

  const displayRows = useMemo(() => {
    if (status === "all") return pipelineRows;
    return pipelineRows.filter((row) => row.status === status);
  }, [pipelineRows, status]);

  const sortedTableRows = useMemo(() => {
    if (isInvoicesHub) {
      return [...displayRows].sort((a, b) => -1 * a.invoiceDateIso.localeCompare(b.invoiceDateIso));
    }
    const openFirst = new Set<InvoiceStatusUi>(["draft", "sent", "partial", "overdue"]);
    return [...displayRows].sort((a, b) => {
      const aOpen = openFirst.has(a.status);
      const bOpen = openFirst.has(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) return a.dueDateIso.localeCompare(b.dueDateIso);
      return b.invoiceDateIso.localeCompare(a.invoiceDateIso);
    });
  }, [displayRows, isInvoicesHub]);

  const invoiceHubPageCount = useMemo(() => {
    if (!isInvoicesHub) return 1;
    return Math.max(1, Math.ceil(sortedTableRows.length / hubPageSize));
  }, [hubPageSize, isInvoicesHub, sortedTableRows.length]);

  const tableBodyRows = useMemo(() => {
    if (!isInvoicesHub) return sortedTableRows;
    const start = (invoiceHubPage - 1) * hubPageSize;
    return sortedTableRows.slice(start, start + hubPageSize);
  }, [hubPageSize, invoiceHubPage, isInvoicesHub, sortedTableRows]);

  const hubScopeFingerprint = useMemo(
    () =>
      [
        hubPageSize,
        balanceDueOnly,
        customPeriodFrom,
        customPeriodTo,
        ledgerFacilityIds?.join(",") ?? "",
        payerType,
        periodPreset,
        residentIdFilter,
        search,
        selectedFacilityId,
        status,
      ].join("|"),
    [
      hubPageSize,
      balanceDueOnly,
      customPeriodFrom,
      customPeriodTo,
      ledgerFacilityIds,
      payerType,
      periodPreset,
      residentIdFilter,
      search,
      selectedFacilityId,
      status,
    ],
  );
  const hubScopeFingerprintRef = useRef(hubScopeFingerprint);
  useEffect(() => {
    if (hubScopeFingerprintRef.current === hubScopeFingerprint) return;
    hubScopeFingerprintRef.current = hubScopeFingerprint;
    queueMicrotask(() => {
      setInvoiceHubPage(1);
      setExpandedHubRowId(null);
      setHubSelectedIds(new Set());
    });
  }, [hubScopeFingerprint]);

  const hubSelectedRows = useMemo(
    () => sortedTableRows.filter((r) => hubSelectedIds.has(r.id)),
    [hubSelectedIds, sortedTableRows],
  );

  const hubVisibleIds = useMemo(() => tableBodyRows.map((r) => r.id), [tableBodyRows]);
  const hubVisibleSelectedCount = useMemo(
    () => hubVisibleIds.filter((id) => hubSelectedIds.has(id)).length,
    [hubSelectedIds, hubVisibleIds],
  );

  useEffect(() => {
    if (!isInvoicesHub || !hubHeaderCheckboxRef.current) return;
    const el = hubHeaderCheckboxRef.current;
    el.indeterminate =
      hubVisibleIds.length > 0 && hubVisibleSelectedCount > 0 && hubVisibleSelectedCount < hubVisibleIds.length;
  }, [hubVisibleIds.length, hubVisibleSelectedCount, isInvoicesHub]);

  function toggleHubSelectAllVisible(nextChecked: boolean) {
    const ids = tableBodyRows.map((r) => r.id);
    setHubSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (nextChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleHubRowSelected(id: string, nextChecked: boolean) {
    setHubSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function scaffoldInvoiceAction(description: string) {
    toast.message("Billing action", { description });
  }

  const overviewFiltersDirty =
    search.trim().length > 0 ||
    status !== DEFAULT_FILTERS.status ||
    payerType !== DEFAULT_FILTERS.payerType ||
    periodPreset !== "this_month" ||
    (ledgerFacilityIds != null && ledgerFacilityIds.length > 0);

  const invoicesHubFiltersDirty = overviewFiltersDirty || balanceDueOnly;

  const hubStatusCounts = useMemo(() => {
    const tally: Record<InvoiceStatusUi, number> = {
      draft: 0,
      sent: 0,
      partial: 0,
      paid: 0,
      overdue: 0,
      void: 0,
      written_off: 0,
    };
    for (const row of pipelineRows) tally[row.status] += 1;
    return tally;
  }, [pipelineRows]);

  const invoiceHubKpis = useMemo(() => {
    const inScope = pipelineRows.length;
    const totalBilledCents = pipelineRows
      .filter((r) => r.status !== "void")
      .reduce((s, r) => s + r.totalCents, 0);
    const outstandingCents = pipelineRows
      .filter((r) => ["draft", "sent", "partial", "overdue"].includes(r.status))
      .reduce((s, r) => s + r.amountDueCents, 0);
    const overdueN = hubStatusCounts.overdue;
    const overduePct = inScope === 0 ? 0 : overdueN / inScope;
    return { inScope, totalBilledCents, outstandingCents, overdueN, overduePct };
  }, [hubStatusCounts, pipelineRows]);

  const hubCsvFilename = useMemo(
    () =>
      buildInvoiceCsvFilename({
        scopeLabel:
          selectedFacilityId != null ? facilityLookup.get(selectedFacilityId) ?? "facility" : "all-facilities",
        period,
        status,
      }),
    [facilityLookup, period, selectedFacilityId, status],
  );

  useEffect(() => {
    if (!isOverviewChrome && !isInvoicesHub) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t instanceof HTMLElement && t.isContentEditable);
      if (typing) {
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey) {
        if (!isOverviewChrome) return;
        e.preventDefault();
        triggerBillingArRefresh();
      }
      const exportFile = isInvoicesHub
        ? hubCsvFilename
        : `billing-ledger_${period.start}_to_${period.end}.csv`;
      if ((e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey) {
        if (!isOverviewChrome && !isInvoicesHub) return;
        e.preventDefault();
        downloadInvoiceLedgerCsv(sortedTableRows, exportFile, facilityLookup);
      }
      if ((e.key === "g" || e.key === "G") && !e.metaKey && !e.ctrlKey && isInvoicesHub) {
        e.preventDefault();
        window.location.assign("/admin/billing/invoices/generate");
      }
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && isInvoicesHub) {
        e.preventDefault();
        document.getElementById("invoice-status-filter-trigger")?.focus();
      }
      if ((e.key === "?" || (e.shiftKey && e.key === "/")) && !e.metaKey && !e.ctrlKey && (isInvoicesHub || isOverviewChrome)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    facilityLookup,
    hubCsvFilename,
    isInvoicesHub,
    isOverviewChrome,
    period,
    sortedTableRows,
  ]);

  const listEmptyCopy = useMemo(() => {
    if (residentIdFilter) {
      return adminListFilteredEmptyCopy({
        datasetRowCount: rowsMatchingPeriodAndFacilities.length,
        whenDatasetEmpty: {
          title: "No invoices for this resident",
          description:
            "There are no invoices linked to this resident in the current scope. They will appear here once billing generates statements.",
        },
        whenFiltersExcludeAll: {
          title: "No invoices match the current filters",
          description: "Adjust status, payer, or search to widen this resident's ledger.",
        },
      });
    }
    if (rowsMatchingPeriodAndFacilities.length === 0) {
      return {
        title: "No invoices in this scope",
        description:
          "Live billing returned no invoices for the selected facility or organization filter for this invoice date range.",
      };
    }
    if (pipelineRows.length === 0) {
      return {
        title: "No invoices match search or payer filters",
        description: "Clear search text or widen payer type — rows dated in-range are being hidden by these filters.",
      };
    }
    return {
      title: "No invoices match this status slice",
      description:
        balanceDueOnly && status === "all"
          ? "Clear the Outstanding balance shortcut or widen other filters."
          : "Pick another chip or set status to All to see invoices in scope.",
    };
  }, [
    balanceDueOnly,
    pipelineRows.length,
    residentIdFilter,
    rowsMatchingPeriodAndFacilities.length,
    status,
  ]);

  const openArTotalCents = useMemo(() => totalOpenArCents(rows), [rows]);
  const aging = useMemo(() => summarizeOpenArBucketTotals(rows), [rows]);
  const overdueCount = rows.filter((row) => row.status === "overdue").length;

  const draftInvoiceCount = useMemo(() => rows.filter((row) => row.status === "draft").length, [rows]);

  const periodInvoiceSnapshot = useMemo(() => {
    const scope = rowsMatchingPeriodAndFacilities.filter((row) => row.status !== "void");
    const billedCents = scope.reduce((s, row) => s + row.totalCents, 0);
    const appliedCents = scope.reduce((s, row) => s + Math.max(0, row.totalCents - row.amountDueCents), 0);
    const ratePct = billedCents > 0 ? (appliedCents / billedCents) * 100 : null;
    return { billedCents, appliedCents, ratePct };
  }, [rowsMatchingPeriodAndFacilities]);

  const ninetyPlusSharePct = openArTotalCents > 0 ? (aging.d91Plus / openArTotalCents) * 100 : null;

  const billingAnomalyMessage = useMemo(() => {
    if (!isOverviewChrome) return null;
    if (cohortCount > 0 && openArTotalCents === 0) {
      return "Outstanding balance reads $0 while this scope still has active resident census.";
    }
    if (openArTotalCents > 0 && aging.d91Plus / openArTotalCents > 0.1) {
      return "More than ten percent of open balances sit in the ninety-plus aging bucket.";
    }
    if (
      periodInvoiceSnapshot.ratePct != null &&
      periodInvoiceSnapshot.billedCents > 0 &&
      periodInvoiceSnapshot.ratePct < 85
    ) {
      return `Applied-to-date collection is below eighty-five percent of invoiced totals for invoice dates ${period.start}→${period.end}.`;
    }
    return null;
  }, [
    aging.d91Plus,
    cohortCount,
    isOverviewChrome,
    openArTotalCents,
    period.start,
    periodInvoiceSnapshot.billedCents,
    periodInvoiceSnapshot.ratePct,
    period.end,
  ]);

  const billingOverviewKpiContext = useMemo((): BillingOverviewKpiContext => {
    const invoiceFetchComplete = facilityReady && !isPending;
    return {
      isLoading,
      loadFailed: Boolean(error),
      invoiceFetchComplete,
      totalInvoiceRows: rows.length,
      openArTotalCents,
      cohortResidentCount: cohortCount,
      periodBilledCents: periodInvoiceSnapshot.billedCents,
      periodAppliedRatePct: periodInvoiceSnapshot.ratePct,
      ninetyPlusSharePct,
      overdueCount,
    };
  }, [
    cohortCount,
    error,
    facilityReady,
    isLoading,
    isPending,
    ninetyPlusSharePct,
    openArTotalCents,
    overdueCount,
    periodInvoiceSnapshot.billedCents,
    periodInvoiceSnapshot.ratePct,
    rows.length,
  ]);

  const outstandingArEmptyCopy = billingOverviewOutstandingArEmptyCopy(billingOverviewKpiContext);
  const ninetyPlusEmptyCopy = billingOverviewNinetyPlusShareEmptyCopy(billingOverviewKpiContext);
  const appliedPeriodEmptyCopy = billingOverviewAppliedPeriodEmptyCopy(billingOverviewKpiContext);
  const overdueCountEmptyCopy = billingOverviewOverdueCountEmptyCopy(billingOverviewKpiContext);
  const billingKpiStripHelperLine = billingOverviewKpiStripHelperLine(billingOverviewKpiContext);

  /** Activity sidebar */
  type PayLine = { id: string; payment_date: string; amount: number };
  type RatePeek = { id: string; name: string; effective_date: string };
  const [activityPayments, setActivityPayments] = useState<PayLine[]>([]);
  const [activityRatesSoon, setActivityRatesSoon] = useState<RatePeek[]>([]);
  const [activityRatesRecent, setActivityRatesRecent] = useState<RatePeek[]>([]);

  useEffect(() => {
    if (!isOverviewChrome) return;
    void (async () => {
      const supabase = createClient();
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAhead = new Date(today);
      weekAhead.setDate(weekAhead.getDate() + 7);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      try {
        let pq = supabase
          .from("payments" as never)
          .select("id, payment_date, amount")
          .is("deleted_at", null)
          .eq("refunded", false)
          .gte("payment_date", iso(weekAgo))
          .order("payment_date", { ascending: false })
          .limit(10);
        if (isValidFacilityIdForQuery(selectedFacilityId)) {
          pq = pq.eq("facility_id", selectedFacilityId!);
        }
        const pres = await pq as unknown as { data: PayLine[] | null; error: { message: string } | null };
        if (!pres.error) setActivityPayments(((pres.data ?? []) as PayLine[]) ?? []);

        let rq = supabase
          .from("rate_schedules" as never)
          .select("id, name, effective_date, deleted_at")
          .is("deleted_at", null)
          .order("effective_date", { ascending: false })
          .limit(40);
        if (isValidFacilityIdForQuery(selectedFacilityId)) {
          rq = rq.eq("facility_id", selectedFacilityId!);
        }
        const rres = await rq as unknown as {
          data: RatePeek[] | null;
          error: { message: string } | null;
        };
        if (!rres.error) {
          const list = (rres.data ?? []) as RatePeek[];
          const t = iso(today);
          const w = iso(weekAhead);
          const wa = iso(weekAgo);
          setActivityRatesSoon(list.filter((r) => r.effective_date >= t && r.effective_date <= w).slice(0, 8));
          setActivityRatesRecent(
            list.filter((r) => r.effective_date < t && r.effective_date >= wa).slice(0, 8),
          );
        }
      } catch {
        setActivityPayments([]);
        setActivityRatesSoon([]);
        setActivityRatesRecent([]);
      }
    })();
  }, [isOverviewChrome, selectedFacilityId]);

  const showFacilitySubsetPicker =
    !residentIdFilter && selectedFacilityId == null && availableFacilities.length > 1;

  function effectiveLedgerFacilityIds(): string[] {
    return ledgerFacilityIds ?? availableFacilities.map((f) => f.id);
  }

  function toggleLedgerFacilityFilter(id: string, checked: boolean) {
    const allIds = availableFacilities.map((f) => f.id);
    const cur = new Set(effectiveLedgerFacilityIds());
    if (checked) cur.add(id);
    else cur.delete(id);
    const arr = allIds.filter((fid) => cur.has(fid));
    if (arr.length === 0 || arr.length === allIds.length) setLedgerFacilityIds(null);
    else setLedgerFacilityIds(arr);
  }

  function chipLedgerStatusChipLabel(s: (typeof HUB_LEDGER_STATUS_CHIPS)[number]): string {
    if (s === "all") return "All";
    if (s === "void") return "Voided";
    return statusExportLabel(s);
  }

  function applySavedLedgerPreset(key: string) {
    setSavedLedgerViewKey(key);
    if (key === "custom") return;
    setCustomPeriodFrom("");
    setCustomPeriodTo("");
    setBalanceDueOnly(false);
    setSearch(DEFAULT_FILTERS.search);
    setPayerType(DEFAULT_FILTERS.payerType);
    setLedgerFacilityIds(null);
    setPeriodPreset("this_month");
    if (key === "overdue_invoices") setStatus("overdue");
    else if (key === "draft_invoices") setStatus("draft");
    else if (key === "void_month") setStatus("void");
    else if (key === "paid_month") setStatus("paid");
  }

  const overdueKpiTone =
    invoiceHubKpis.overdueN === 0
      ? "text-muted-foreground"
      : invoiceHubKpis.overduePct > 0.05
        ? "text-destructive"
        : "text-amber-600 dark:text-amber-300";

  const resolvedCardDescription = isOverviewChrome
    ? "Invoices dated in the billing period and table filters below. Amount due is the open balance on each row."
    : cardDescription;

  const showFacilityHubColumn = isInvoicesHub && selectedFacilityId == null && !residentIdFilter;
  const hubLedgerColSpan = 10 + (showFacilityHubColumn ? 1 : 0);

  return (
    <div className={cn("w-full space-y-6 pb-12", layout === "overview" ? "" : "")}>
      {!isOverviewChrome && title ? (
        <header className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        </header>
      ) : null}

      {isOverviewChrome ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xl text-[13px] text-muted-foreground">
            Snapshot for your current Billing header scope — open aging, rates, and org AR tabs for deeper slices.
          </p>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Link
              href="/admin/billing/invoices/generate"
              className={cn(buttonVariants({ size: "sm", variant: "default" }), "h-9")}
            >
              Generate invoices
            </Link>
            <Link href="/admin/billing/payments/new" className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-9")}>
              Record payment
            </Link>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href="/admin/billing/collections"
                    className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "inline-flex h-9 items-center")}
                  >
                    Run collections
                  </Link>
                }
              />
              <TooltipContent side="bottom" className="max-w-[15rem] text-left text-xs leading-snug">
                Continue follow-up on overdue balances — cadence templates and outreach notes live on the collections
                view.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : null}

      {isOverviewChrome && billingAnomalyMessage ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-[13px] text-foreground dark:bg-amber-500/15"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <p className="leading-relaxed">{billingAnomalyMessage}</p>
        </div>
      ) : null}

      {isOverviewChrome ? (
        <div className="rounded-xl border border-border bg-card p-[14px] shadow-[var(--shadow-card)] ring-1 ring-border/60">
          <h3 className="text-[14px] font-semibold text-foreground">Action queue</h3>
          <ul className="mt-3 list-none space-y-2 text-[13px] leading-snug">
            <li className={overdueCount > 0 ? "" : "text-muted-foreground"}>
              <Link href="/admin/billing/invoices?status=overdue" className="text-primary underline-offset-4 hover:underline">
                {billingActionQueueOverdueCopy(billingOverviewKpiContext)}
              </Link>
            </li>
            <li className={draftInvoiceCount > 0 ? "" : "text-muted-foreground"}>
              <Link href="/admin/billing/invoices?status=draft" className="text-primary underline-offset-4 hover:underline">
                {billingActionQueueDraftCopy(draftInvoiceCount, billingOverviewKpiContext)}
              </Link>
            </li>
            <li className={billingOverviewKpiContext.totalInvoiceRows === 0 ? "" : "text-muted-foreground"}>
              <Link
                href="/admin/billing/invoices/opening-balance"
                className="text-primary underline-offset-4 hover:underline"
              >
                {billingOverviewKpiContext.totalInvoiceRows === 0
                  ? "Import opening balance for migrated AR"
                  : "Opening balance entry for new residents"}
              </Link>
            </li>
            <li>
              <Link href="/admin/billing/ar-aging" className="text-primary underline-offset-4 hover:underline">
                Open AR aging for bucket detail
              </Link>
            </li>
          </ul>
        </div>
      ) : null}

      {isOverviewChrome ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricLinkTile
              href="/admin/billing/ar-aging"
              label="Outstanding AR"
              value={
                outstandingArEmptyCopy ?? billingCurrency.format(openArTotalCents / 100)
              }
              valuePresentation={outstandingArEmptyCopy != null ? "message" : "metric"}
              valueClassName={
                outstandingArEmptyCopy != null
                  ? "text-muted-foreground"
                  : outstandingArValueClass({
                      outstandingCents: openArTotalCents,
                      cohortResidentCount: cohortCount,
                      ninetyPlusCents: aging.d91Plus,
                    })
              }
            />
            <MetricLinkTile
              href="/admin/billing/ar-aging?bucket=91-plus"
              label="90+ share of open AR"
              value={
                ninetyPlusEmptyCopy ?? `${Math.round(ninetyPlusSharePct ?? 0)}%`
              }
              valuePresentation={ninetyPlusEmptyCopy != null ? "message" : "metric"}
              valueClassName={
                ninetyPlusEmptyCopy != null
                  ? "text-muted-foreground"
                  : ninetyPlusRiskShareClass(openArTotalCents, aging.d91Plus)
              }
              labelTooltip="Percentage of outstanding balance that sits in ninety-plus aging. Details on the Aging tab."
            />
            <MetricLinkTile
              href="/admin/billing/invoices"
              label="Applied (invoice period)"
              value={
                appliedPeriodEmptyCopy ?? `${Math.round(periodInvoiceSnapshot.ratePct ?? 0)}%`
              }
              valuePresentation={appliedPeriodEmptyCopy != null ? "message" : "metric"}
              valueClassName={
                appliedPeriodEmptyCopy != null
                  ? "text-muted-foreground"
                  : collectionRateSemanticClass(periodInvoiceSnapshot.ratePct)
              }
              labelTooltip={`Share of non-void invoiced totals dated ${period.start}–${period.end} that already have payments or adjustments applied (ledger snapshot).`}
            />
            <MetricLinkTile
              href="/admin/billing/invoices?status=overdue"
              label="Overdue invoices"
              value={overdueCountEmptyCopy ?? String(overdueCount)}
              valuePresentation={overdueCountEmptyCopy != null ? "message" : "metric"}
              valueClassName={
                overdueCountEmptyCopy != null ? "text-muted-foreground" : overdueInvoicesValueClass(overdueCount)
              }
            />
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{billingKpiStripHelperLine}</p>
        </div>
      ) : null}

      {isInvoicesHub ? (
        <section aria-label="Invoice KPIs for current filters" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <button
            type="button"
            className={cn(
              "rounded-xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={() => {
              setBalanceDueOnly(false);
              setStatus("all");
            }}
          >
            <p className="text-[12px] font-medium text-muted-foreground">Invoices in scope</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {invoiceHubKpis.inScope === 0 ? "—" : invoiceHubKpis.inScope}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {period.start} → {period.end}
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "rounded-xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={() => {
              setBalanceDueOnly(false);
              setStatus("all");
            }}
          >
            <p className="text-[12px] font-medium text-muted-foreground">Total billed</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {invoiceHubKpis.inScope === 0 ? "—" : billingCurrency.format(invoiceHubKpis.totalBilledCents / 100)}
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "rounded-xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={() => {
              setBalanceDueOnly(true);
              setStatus("all");
            }}
          >
            <p className="text-[12px] font-medium text-muted-foreground">Outstanding</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {invoiceHubKpis.inScope === 0 ? "—" : billingCurrency.format(invoiceHubKpis.outstandingCents / 100)}
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "rounded-xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={() => {
              setBalanceDueOnly(false);
              setStatus("overdue");
            }}
          >
            <p className="text-[12px] font-medium text-muted-foreground">Overdue</p>
            <p className={cn("mt-2 text-2xl font-semibold tabular-nums", overdueKpiTone)}>
              {invoiceHubKpis.inScope === 0 ? "—" : invoiceHubKpis.overdueN}
            </p>
          </button>
        </section>
      ) : null}

      <AdminFilterBar
        searchValue={search}
        searchInputRef={isOverviewChrome || isInvoicesHub ? searchInputRef : undefined}
        searchPlaceholder="Search invoice # or resident…"
        onSearchChange={setSearch}
        suppressResetUnlessDirty={
          isOverviewChrome ? !overviewFiltersDirty : isInvoicesHub ? !invoicesHubFiltersDirty : true
        }
        filters={[
          ...(isOverviewChrome || isInvoicesHub
            ? [
                {
                  id: "billing-period-filter",
                  ariaLabel: "Invoice date range",
                  value: periodPreset,
                  onChange: (v: string) => setPeriodPreset(v as PeriodPreset),
                  options: isInvoicesHub ? INVOICES_HUB_PERIOD_FILTER_OPTIONS : OVERVIEW_PERIOD_FILTER_OPTIONS,
                },
              ]
            : []),
          {
            id: "invoice-status-filter",
            ariaLabel: "Invoice status",
            triggerPrefix: isInvoicesHub ? <Filter className="size-3.5 shrink-0" aria-hidden /> : undefined,
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "partial", label: "Partial" },
              { value: "paid", label: "Paid" },
              { value: "overdue", label: "Overdue" },
              { value: "void", label: "Void" },
              { value: "written_off", label: "Written off" },
            ],
          },
          {
            id: "payer-type-filter",
            ariaLabel: "Payer type",
            value: payerType,
            onChange: setPayerType,
            options: [
              { value: "all", label: "All payer types" },
              { value: "private_pay", label: "Private pay" },
              { value: "medicaid", label: "Medicaid" },
              { value: "ltc_insurance", label: "LTC insurance" },
            ],
          },
        ]}
        trailingSlot={
          isOverviewChrome ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {showFacilitySubsetPicker ? (
                <Popover>
                  <PopoverTrigger
                    type="button"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 px-2 text-[12px]")}
                  >
                    {ledgerFacilityIds == null ? "Facilities · All" : `Facilities · ${ledgerFacilityIds.length}`}
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <p className="mb-2 text-[12px] font-medium text-foreground">Table facility subset</p>
                    <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                      KPI tiles still follow the Billing header scope. Use this list to narrow the ledger when you are in
                      all facilities.
                    </p>
                    <button
                      type="button"
                      className="mb-3 text-[11px] font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => setLedgerFacilityIds(null)}
                    >
                      Include all accessible facilities
                    </button>
                    <div className="max-h-56 space-y-2 overflow-y-auto">
                      {availableFacilities.map((f) => (
                        <label key={f.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={effectiveLedgerFacilityIds().includes(f.id)}
                            onChange={(e) => toggleLedgerFacilityFilter(f.id, e.target.checked)}
                          />
                          <span>{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-[12px]"
                onClick={() =>
                  downloadInvoiceLedgerCsv(
                    sortedTableRows,
                    `billing-ledger_${period.start}_to_${period.end}.csv`,
                    facilityLookup,
                  )
                }
              >
                <Download className="size-3.5" aria-hidden />
                CSV
              </Button>
            </div>
          ) : isInvoicesHub ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {showFacilitySubsetPicker ? (
                <Popover>
                  <PopoverTrigger
                    type="button"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 px-2 text-[12px]")}
                  >
                    {ledgerFacilityIds == null ? "Facilities · All" : `Facilities · ${ledgerFacilityIds.length}`}
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <p className="mb-2 text-[12px] font-medium text-foreground">Facility filter</p>
                    <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                      Default is all facilities in the organization. Clear checkboxes to narrow the invoice list and
                      exports.
                    </p>
                    <button
                      type="button"
                      className="mb-3 text-[11px] font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => setLedgerFacilityIds(null)}
                    >
                      Select all facilities
                    </button>
                    <div className="max-h-56 space-y-2 overflow-y-auto">
                      {availableFacilities.map((f) => (
                        <label key={f.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={effectiveLedgerFacilityIds().includes(f.id)}
                            onChange={(e) => toggleLedgerFacilityFilter(f.id, e.target.checked)}
                          />
                          <span>{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
              <Link
                href="/admin/billing/invoices/generate"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex h-8 items-center px-3 text-[12px]")}
              >
                Generate invoices
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-[12px]"
                onClick={() => downloadInvoiceLedgerCsv(sortedTableRows, hubCsvFilename, facilityLookup)}
              >
                <Download className="size-3.5" aria-hidden />
                Export
              </Button>
            </div>
          ) : undefined
        }
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatus(DEFAULT_FILTERS.status);
          setPayerType(DEFAULT_FILTERS.payerType);
          setPeriodPreset("this_month");
          setLedgerFacilityIds(null);
          setCustomPeriodFrom("");
          setCustomPeriodTo("");
          setBalanceDueOnly(false);
          setSavedLedgerViewKey("custom");
          setInvoiceHubPage(1);
        }}
      />

      {error ? (
        <AdminLiveDataFallbackNotice
          message={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      {isInvoicesHub && periodPreset === "custom" ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="invoice-custom-from" className="text-[12px] text-muted-foreground">
                Range from
              </Label>
              <DateInput
                id="invoice-custom-from"
                value={customPeriodFrom}
                onValueChange={setCustomPeriodFrom}
                emptyHint={null}
                className="h-9 w-[11.5rem] text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invoice-custom-to" className="text-[12px] text-muted-foreground">
                Range to
              </Label>
              <DateInput
                id="invoice-custom-to"
                value={customPeriodTo}
                onValueChange={setCustomPeriodTo}
                emptyHint={null}
                className="h-9 w-[11.5rem] text-[13px]"
              />
            </div>
          </div>
          {periodPreset === "custom" && (!customPeriodFrom || !customPeriodTo) ? (
            <p className="mt-2 text-[12px] text-muted-foreground">Pick both dates to lock a custom billing window.</p>
          ) : null}
        </div>
      ) : null}

      {isInvoicesHub ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">
            Range:&nbsp;
            <span className="text-muted-foreground">
              {period.start} → {period.end}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="saved-ledger-view-select" className="sr-only">
              Saved views
            </Label>
            <Select
              value={savedLedgerViewKey}
              onValueChange={(v) => applySavedLedgerPreset(v)}
              disabled={availableFacilities.length === 0}
            >
              <SelectTrigger id="saved-ledger-view-select" className="h-8 w-[14rem] text-[12px]" aria-label="Saved ledger views">
                <SelectValue placeholder="Saved view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom (current filters)</SelectItem>
                <SelectItem value="overdue_invoices">Overdue invoices</SelectItem>
                <SelectItem value="draft_invoices">Draft invoices</SelectItem>
                <SelectItem value="void_month">Voided this month</SelectItem>
                <SelectItem value="paid_month">Paid this month</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-[12px]"
              onClick={() => toast.message("Save view", { description: "Per-user saved views will persist once storage ships." })}
            >
              Save current…
            </Button>
          </div>
        </div>
      ) : null}

      {isInvoicesHub ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Invoice status quick filters">
          {HUB_LEDGER_STATUS_CHIPS.map((key) => {
            const count = key === "all" ? pipelineRows.length : hubStatusCounts[key];
            const active =
              !balanceDueOnly &&
              ((key === "all" && status === "all") || (key !== "all" && status === key));
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => {
                  setBalanceDueOnly(false);
                  setStatus(key === "all" ? "all" : key);
                }}
              >
                {chipLedgerStatusChipLabel(key)} ({count})
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-6",
          isOverviewChrome ? "lg:grid-cols-5 lg:items-start" : "",
        )}
      >
        <div className={cn(isOverviewChrome ? "min-w-0 lg:col-span-3" : "min-w-0")}>
          <AdminOperationalListPanel
            toolbar={
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-foreground">{cardTitle}</p>
                {resolvedCardDescription ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{resolvedCardDescription}</p>
                ) : null}
              </div>
            }
          >
            {isInvoicesHub && hubSelectedIds.size > 0 && !isLoading ? (
              <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2 text-[12px] shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
                <span className="font-medium tabular-nums text-foreground">{hubSelectedIds.size} selected</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setBulkPayDialogOpen(true)}>
                    Mark paid
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    onClick={() => scaffoldInvoiceAction("Reminder queue will connect once messaging rules ship.")}
                  >
                    Send reminder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    onClick={() => scaffoldInvoiceAction("Merged PDF bundles are not wired yet.")}
                  >
                    Download PDFs
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkVoidDialogOpen(true)}
                  >
                    Void
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    onClick={() =>
                      downloadInvoiceLedgerCsv(
                        hubSelectedRows,
                        withSelectedInvoiceCsvSuffix(hubCsvFilename, hubSelectedRows.length),
                        facilityLookup,
                      )
                    }
                  >
                    Export selected
                  </Button>
                </div>
              </div>
            ) : null}
            {isInvoicesHub ? (
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      <span className="sr-only">Select invoice</span>
                      <input
                        ref={hubHeaderCheckboxRef}
                        type="checkbox"
                        checked={hubVisibleIds.length > 0 && hubVisibleSelectedCount === hubVisibleIds.length}
                        aria-label="Select all invoices visible on this page"
                        disabled={hubVisibleIds.length === 0}
                        className={cn(
                          "size-4 rounded border border-input bg-background accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => toggleHubSelectAllVisible(e.target.checked)}
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Invoice #
                    </TableHead>
                    {showFacilityHubColumn ? (
                      <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                        Facility
                      </TableHead>
                    ) : null}
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Resident
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Payer
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      <button
                        type="button"
                        className="-ml-1 inline-flex items-center rounded px-1 text-left font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setHubLedgerSortDesc((d) => !d)}
                      >
                        Invoice date{" "}
                        <span aria-hidden className="ml-0.5 inline-block tabular-nums opacity-75">
                          {hubLedgerSortDesc ? "↓" : "↑"}
                        </span>
                      </button>
                    </TableHead>
                    <TableHead className="text-right text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Billed
                    </TableHead>
                    <TableHead className="text-right text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Outstanding
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Due date
                    </TableHead>
                    <TableHead className="text-right text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={hubLedgerColSpan} className="py-8 text-[13px] text-muted-foreground">
                        Loading invoices…
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {tableBodyRows.map((row) => {
                        const fin = facilityLookup.get(row.facilityId) ?? "Facility";
                        return (
                          <React.Fragment key={row.id}>
                            <TableRow
                              className={cn(
                                "cursor-pointer hover:bg-muted/35",
                                expandedHubRowId === row.id ? "bg-muted/25" : "",
                              )}
                              onClick={() => setExpandedHubRowId((cur) => (cur === row.id ? null : row.id))}
                            >
                              <TableCell
                                className="w-10"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={hubSelectedIds.has(row.id)}
                                  aria-label={`Select invoice ${row.invoiceNumber}`}
                                  className={cn(
                                    "size-4 rounded border border-input bg-background accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    "cursor-pointer",
                                  )}
                                  onChange={(e) => toggleHubRowSelected(row.id, e.target.checked)}
                                />
                              </TableCell>
                              <TableCell className="font-medium tabular-nums text-foreground">{row.invoiceNumber}</TableCell>
                              {showFacilityHubColumn ? (
                                <TableCell className="max-w-[10rem] text-[13px]">
                                  <Link
                                    href={`/admin/facilities/${row.facilityId}?tab=rates`}
                                    className="font-medium text-primary underline-offset-4 hover:underline"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {facilityBillingShortLabel(fin)}
                                  </Link>
                                </TableCell>
                              ) : null}
                              <TableCell className="max-w-[11rem] truncate text-[13px] text-foreground">
                                {row.residentName}
                              </TableCell>
                              <TableCell>
                                <PayerTypeBadge payerType={row.payerType} />
                              </TableCell>
                              <TableCell className="tabular-nums text-[13px] text-muted-foreground">{row.invoiceDateIso}</TableCell>
                              <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                                {billingCurrency.format(row.totalCents / 100)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span>{billingCurrency.format(row.amountDueCents / 100)}</span>
                                  {row.adjustmentsCents < 0 ? (
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                      Concession {billingCurrency.format(Math.abs(row.adjustmentsCents) / 100)}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                <InvoiceStatusBadge status={row.status} />
                              </TableCell>
                              <TableCell className="text-[13px] text-muted-foreground">{row.dueDate}</TableCell>
                              <TableCell className="text-right" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    type="button"
                                    aria-label={`Actions for invoice ${row.invoiceNumber}`}
                                    className={cn(
                                      buttonVariants({ variant: "ghost", size: "icon" }),
                                      "inline-flex size-9 shrink-0 text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    <MoreHorizontal className="size-4" aria-hidden />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-52 text-[13px]">
                                    <DropdownMenuItem onClick={() => router.push(`/admin/billing/invoices/${row.id}`)}>View invoice</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => scaffoldInvoiceAction("Send workflows are not wired yet.")}>Send</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => router.push(collectionActivityHref(row.residentId, row.id))}>
                                      Log reminder/contact
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => router.push(paymentHref(row.residentId, row.id, row.amountDueCents))}>
                                      Record payment
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => router.push(`/admin/billing/invoices/${row.id}`)}>
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem variant="destructive" onClick={() => scaffoldInvoiceAction("Void must post an audit-safe reversal.")}>
                                      Void
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => scaffoldInvoiceAction("PDF rendering is queued for billing hardening.")}>
                                      Download PDF
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => router.push(`/admin/residents/${row.residentId}/billing`)}>
                                      View payment history
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                            {expandedHubRowId === row.id ? (
                              <TableRow className="hover:bg-transparent bg-muted/20">
                                <TableCell colSpan={hubLedgerColSpan} className="align-top whitespace-normal">
                                  <div className="grid min-w-0 gap-4 py-2 text-[13px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,auto)]">
                                    <div className="min-w-0 rounded-md border border-border/70 bg-background/70 p-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Line items</p>
                                      <p className="mt-2 max-w-prose break-words leading-relaxed text-muted-foreground">
                                        Charges and service periods publish from the cashiering rollup — nothing to show until line-level posting
                                        syncs here.
                                      </p>
                                    </div>
                                    <div className="min-w-0 rounded-md border border-border/70 bg-background/70 p-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Payments & timeline
                                      </p>
                                      <p className="mt-2 max-w-prose break-words leading-relaxed text-muted-foreground">
                                        Applied tenders, timestamps, actors, memo, and linked documents hydrate after the ledger engine exposes
                                        remittance bundles.
                                      </p>
                                    </div>
                                    <div className="min-w-0 rounded-md border border-border/70 bg-background/70 p-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Row actions</p>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 text-[12px]"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(collectionActivityHref(row.residentId, row.id));
                                          }}
                                        >
                                          Reminder
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 text-[12px]"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(`/admin/billing/invoices/${row.id}`);
                                          }}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 text-[12px]"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(paymentHref(row.residentId, row.id, row.amountDueCents));
                                          }}
                                        >
                                          Record payment
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 text-[12px] text-destructive hover:bg-destructive/10"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            scaffoldInvoiceAction("Void must post an audited reversal.");
                                          }}
                                        >
                                          Void
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 text-[12px]"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            scaffoldInvoiceAction("PDF rendering is queued for billing hardening.");
                                          }}
                                        >
                                          Download PDF
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                      {tableBodyRows.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={hubLedgerColSpan} className="align-top py-8">
                            <p className="text-[13px] font-medium text-foreground">{listEmptyCopy.title}</p>
                            <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
                              {listEmptyCopy.description}
                            </p>
                            {isInvoicesHub && rowsMatchingPeriodAndFacilities.length === 0 ? (
                              <p className="mt-3 text-[12px] text-muted-foreground">
                                <Link
                                  href="/admin/billing/invoices/generate"
                                  className="font-medium text-primary underline-offset-4 hover:underline"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Generate invoices
                                </Link>
                                <span aria-hidden>&nbsp;</span>
                                <span className="text-muted-foreground">or widen filters.</span>
                              </p>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  )}
                </TableBody>
              </Table>
            ) : (
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Invoice #
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Resident
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Payer
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Amount
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Due date
                    </TableHead>
                    <TableHead className="text-right text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-8 text-[13px] text-muted-foreground">
                        Loading invoices…
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {tableBodyRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium tabular-nums text-foreground">
                            {row.invoiceNumber}
                          </TableCell>
                          <TableCell className="max-w-[12rem] truncate text-[13px] text-foreground">
                            {row.residentName}
                          </TableCell>
                          <TableCell>
                            <PayerTypeBadge payerType={row.payerType} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{billingCurrency.format(row.amountDueCents / 100)}</span>
                              {row.adjustmentsCents < 0 ? (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                  Concession {billingCurrency.format(Math.abs(row.adjustmentsCents) / 100)}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <InvoiceStatusBadge status={row.status} />
                          </TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">{row.dueDate}</TableCell>
                          <TableCell className="text-right">
                            <Link
                              href={`/admin/billing/invoices/${row.id}`}
                              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                            >
                              Open
                              <ChevronRight className="size-4" aria-hidden />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                      {tableBodyRows.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="align-top py-8">
                            <p className="text-[13px] font-medium text-foreground">{listEmptyCopy.title}</p>
                            <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
                              {listEmptyCopy.description}
                            </p>
                            {isOverviewChrome && rows.length === 0 ? (
                              <Link
                                href="/admin/billing/invoices/generate"
                                className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-4 inline-flex h-8")}
                              >
                                Generate invoices
                              </Link>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  )}
                </TableBody>
              </Table>
            )}
            {isInvoicesHub && !isLoading && sortedTableRows.length > 50 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
                <span className="tabular-nums">
                  Showing {(invoiceHubPage - 1) * hubPageSize + 1}–{Math.min(invoiceHubPage * hubPageSize, sortedTableRows.length)} of{" "}
                  {sortedTableRows.length}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Rows</span>
                    <Select value={String(hubPageSize)} onValueChange={(v) => setHubPageSize(Number.parseInt(v, 10))}>
                      <SelectTrigger className="h-8 w-[4.5rem] text-[12px]" aria-label="Rows per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    disabled={invoiceHubPage <= 1}
                    onClick={() => setInvoiceHubPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    disabled={invoiceHubPage >= invoiceHubPageCount}
                    onClick={() => setInvoiceHubPage((p) => Math.min(invoiceHubPageCount, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </AdminOperationalListPanel>
        </div>

        {isOverviewChrome ? (
          <aside className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-[14px] shadow-[var(--shadow-card)] ring-1 ring-border/60">
              <h2 className="text-[14px] font-semibold text-foreground">Activity this week</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Recent cash application, rate effective dates, and upcoming schedule notes.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Payments applied</p>
                  {activityPayments.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">No payments in the last 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityPayments.map((p) => (
                        <li key={p.id} className="text-[13px] text-foreground">
                          <span className="tabular-nums font-medium">{billingCurrency.format(p.amount / 100)}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-muted-foreground">{p.payment_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Rate changes (effective)</p>
                  {activityRatesRecent.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">No rate schedule starts in the last 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityRatesRecent.map((r) => (
                        <li key={r.id} className="text-[13px]">
                          <Link href="/admin/billing/rates" className="text-primary hover:underline">
                            {r.name}
                          </Link>
                          <span className="text-muted-foreground"> · effective {r.effective_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Upcoming rate effective dates</p>
                  {activityRatesSoon.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">None in the next 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityRatesSoon.map((r) => (
                        <li key={r.id} className="text-[13px] text-foreground">
                          {r.name}
                          <span className="text-muted-foreground"> · {r.effective_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Scheduled invoicing</p>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Batch generation runs will surface here once scheduling is configured.{" "}
                    <Link href="/admin/billing/settings" className="text-primary underline-offset-4 hover:underline">
                      Billing settings
                    </Link>{" "}
                    explains what is available in this pilot build.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={bulkVoidDialogOpen} onOpenChange={setBulkVoidDialogOpen}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="text-base">Void selected invoices?</DialogTitle>
            <DialogDescription className="text-[13px]">
              Applies to <span className="tabular-nums font-medium text-foreground">{hubSelectedIds.size}</span> selected
              row{hubSelectedIds.size === 1 ? "" : "s"}. Reversal posting is scaffold-only until cashiering publishes void
              batches.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setBulkVoidDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8 text-[12px]"
              onClick={() => {
                scaffoldInvoiceAction("Bulk void postings are gated on cashiering + audit envelopes.");
                setHubSelectedIds(new Set());
                setBulkVoidDialogOpen(false);
              }}
            >
              Confirm void (scaffold)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPayDialogOpen} onOpenChange={setBulkPayDialogOpen}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="text-base">Record bulk payment</DialogTitle>
            <DialogDescription className="text-[13px]">
              Scaffold for allocating one tender across{" "}
              <span className="tabular-nums font-medium text-foreground">{hubSelectedIds.size}</span> invoice row
              {hubSelectedIds.size === 1 ? "" : "s"}. Applies-to waterfall still routes through the cashiering engine.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            <div className="space-y-1">
              <Label htmlFor="bulk-pay-date">Payment date</Label>
              <Input id="bulk-pay-date" type="date" className="h-9" disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-pay-method">Method</Label>
              <Input id="bulk-pay-method" placeholder="ACH / Card / Check" className="h-9" disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-pay-ref">Reference / trace</Label>
              <Input id="bulk-pay-ref" placeholder="Issuer reference" className="h-9" disabled />
            </div>
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
              Allocation rules and NSF handling stay in cashiering scope — wiring here is UX-only until posting ships.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setBulkPayDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-[12px]"
              onClick={() => {
                toast.message("Bulk payment scaffold", {
                  description: "Posting engine will apply tenders once cashiering publishes split rules.",
                });
                setBulkPayDialogOpen(false);
              }}
            >
              Save scaffold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="text-base">Invoice ledger shortcuts</DialogTitle>
            <DialogDescription className="text-[13px]">Keyboard cues while focus is outside fields.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-[13px] text-foreground">
            <li className="flex justify-between gap-4">
              <span className="font-mono tabular-nums">/</span>
              <span className="text-muted-foreground">Focus search</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="font-mono tabular-nums">?</span>
              <span className="text-muted-foreground">Open this list</span>
            </li>
            {isOverviewChrome ? (
              <li className="flex justify-between gap-4">
                <span className="font-mono tabular-nums">R</span>
                <span className="text-muted-foreground">Refresh this overview</span>
              </li>
            ) : null}
            <li className="flex justify-between gap-4">
              <span className="font-mono tabular-nums">E</span>
              <span className="text-muted-foreground">Export CSV (all filtered rows)</span>
            </li>
            {isInvoicesHub ? (
              <>
                <li className="flex justify-between gap-4">
                  <span className="font-mono tabular-nums">F</span>
                  <span className="text-muted-foreground">Focus invoice status filter</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="font-mono tabular-nums">G</span>
                  <span className="text-muted-foreground">Generate invoices</span>
                </li>
              </>
            ) : null}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setShortcutsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function BillingInvoiceLedger(props: BillingInvoiceLedgerProps) {
  return (
    <QueryClientLayout>
      <Suspense
        fallback={
          <div className="rounded-xl border border-border bg-card p-6 text-[13px] text-muted-foreground shadow-[var(--shadow-card)] ring-1 ring-border/60">
            Loading billing ledger…
          </div>
        }
      >
        <BillingInvoiceLedgerInner {...props} />
      </Suspense>
    </QueryClientLayout>
  );
}

export function PayerTypeBadge({ payerType }: { payerType: PayerTypeUi }) {
  const map: Record<PayerTypeUi, { label: string; className: string }> = {
    private_pay: {
      label: "Private pay",
      className: "border-0 bg-muted/80 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    medicaid: {
      label: "Medicaid",
      className: "border-0 bg-blue-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    ltc_insurance: {
      label: "LTC insurance",
      className: "border-0 bg-primary/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
  };
  return <Badge className={map[payerType].className}>{map[payerType].label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusUi }) {
  const map: Record<InvoiceStatusUi, { label: string; className: string; icon?: React.ReactNode }> = {
    draft: {
      label: "Draft",
      className: "border-0 bg-muted/80 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    sent: {
      label: "Sent",
      className:
        "border-0 bg-blue-500/15 text-foreground dark:bg-blue-500/20 text-[11px] font-medium normal-case tracking-normal",
    },
    partial: {
      label: "Partial",
      className:
        "border-0 bg-amber-500/15 text-foreground dark:bg-amber-500/20 text-[11px] font-medium normal-case tracking-normal",
    },
    paid: {
      label: "Paid",
      className:
        "border-0 bg-emerald-500/15 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-50 text-[11px] font-medium normal-case tracking-normal",
      icon: <Check className="size-3.5 shrink-0" aria-hidden />,
    },
    overdue: {
      label: "Overdue",
      className:
        "border-0 bg-destructive/15 text-destructive text-[11px] font-medium normal-case tracking-normal",
      icon: <AlertTriangle className="size-3.5 shrink-0" aria-hidden />,
    },
    void: {
      label: "Voided",
      className:
        "line-through border-0 bg-muted text-muted-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    written_off: {
      label: "Written off",
      className:
        "border-0 bg-orange-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
  };
  const cfg = map[status];
  return (
    <Badge className={cn(cfg.className, "inline-flex items-center gap-1")}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}
