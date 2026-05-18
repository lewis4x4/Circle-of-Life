"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Download,
  MoreHorizontal,
  TrendingUp,
} from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { DateInput } from "@/components/ui/date-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { billingNyTodayIso, daysPastDueAsOf } from "@/lib/billing/ar-aging-as-of";
import { ninetyPlusRiskShareClass } from "@/lib/billing/billing-ar-semantics";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const OPEN = ["draft", "sent", "partial", "overdue"] as const;

export type ArBucketUrlKey = "current" | "31-60" | "61-90" | "91-plus";

const BUCKET_LABELS: Record<ArBucketUrlKey | "all", string> = {
  all: "Total open",
  current: "Current (0–30 days past due)",
  "31-60": "31–60 days past due",
  "61-90": "61–90 days past due",
  "91-plus": "90+ days past due",
};

type PayerDb =
  | "private_pay"
  | "medicaid_oss"
  | "va_aid_attendance"
  | "ltc_insurance"
  | "other";

const PAYER_OPTIONS: { db: PayerDb; label: string }[] = [
  { db: "private_pay", label: "Private pay" },
  { db: "medicaid_oss", label: "Medicaid" },
  { db: "va_aid_attendance", label: "VA" },
  { db: "ltc_insurance", label: "LTC insurance" },
  { db: "other", label: "Other" },
];

type RawInv = {
  id: string;
  resident_id: string;
  facility_id: string;
  due_date: string;
  balance_due: number;
  status: string;
  payer_type: string | null;
  invoice_number: string;
  deleted_at: string | null;
};

type ResidentRollup = {
  residentId: string;
  residentName: string;
  facilityId: string;
  facilityName: string;
  oldestDueIso: string;
  totalCents: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91: number;
  counts: { b0_30: number; b31_60: number; b61_90: number; b91: number; total: number };
  invoices: RawInv[];
};

type InvoiceRollupRow = RawInv & {
  residentName: string;
  facilityName: string;
  bucketDays: number;
  bucketAmountCents: number;
};

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function bucketIndexFromDays(days: number): keyof Pick<ResidentRollup, "b0_30" | "b31_60" | "b61_90" | "b91"> {
  if (days > 90) return "b91";
  if (days > 60) return "b61_90";
  if (days > 30) return "b31_60";
  return "b0_30";
}

function bucketFieldFromUrl(b: ArBucketUrlKey | null): keyof Pick<ResidentRollup, "b0_30" | "b31_60" | "b61_90" | "b91"> | null {
  if (!b) return null;
  if (b === "current") return "b0_30";
  if (b === "31-60") return "b31_60";
  if (b === "61-90") return "b61_90";
  if (b === "91-plus") return "b91";
  return null;
}

function formatUsdCell(cents: number): string {
  return cents > 0 ? billingCurrency.format(cents / 100) : "—";
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** When org-wide hub scope (no pinned facility), empty array means “all facilities”. */
function effectiveFacilityFilterIds(
  scopeFacilityId: string | null,
  orgSelection: string[],
): string[] | null {
  if (isValidFacilityIdForQuery(scopeFacilityId)) return [scopeFacilityId!];
  if (orgSelection.length === 0) return null;
  return orgSelection;
}

function AdminArAgingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bucketParam = searchParams.get("bucket");
  const bucketFilter = (
    ["current", "31-60", "61-90", "91-plus"].includes(bucketParam ?? "") ? bucketParam : null
  ) as ArBucketUrlKey | null;

  const asOfParam = searchParams.get("asOf");
  const initialAsOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : billingNyTodayIso();

  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const orgWideHub = !isValidFacilityIdForQuery(selectedFacilityId);

  const [asOfDate, setAsOfDate] = useState(initialAsOf);
  const [rollupMode, setRollupMode] = useState<"resident" | "invoice">("resident");
  /** Org-wide only; empty = all facilities */
  const [facilitySelection, setFacilitySelection] = useState<string[]>([]);
  /** Empty set = all payer types */
  const [payerSelection, setPayerSelection] = useState<PayerDb[]>([]);

  const [rawInvoices, setRawInvoices] = useState<RawInv[]>([]);
  const [residentCount, setResidentCount] = useState<number | null>(null);
  const [anyInvoiceCount, setAnyInvoiceCount] = useState<number | null>(null);
  const [facilityNames, setFacilityNames] = useState<Record<string, string>>({});
  const [residentNames, setResidentNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedResidents, setExpandedResidents] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedResidents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const syncQueryParams = useCallback(
    (next: { asOf?: string; bucket?: ArBucketUrlKey | null }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.asOf !== undefined) {
        if (next.asOf === billingNyTodayIso()) p.delete("asOf");
        else p.set("asOf", next.asOf);
      }
      if (next.bucket !== undefined) {
        if (next.bucket == null) p.delete("bucket");
        else p.set("bucket", next.bucket);
      }
      router.replace(`/admin/billing/ar-aging?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const facilityIds = effectiveFacilityFilterIds(selectedFacilityId, facilitySelection);

      let invQ = supabase
        .from("invoices" as never)
        .select(
          "id, resident_id, facility_id, due_date, balance_due, status, payer_type, invoice_number, deleted_at",
        )
        .is("deleted_at", null)
        .gt("balance_due", 0)
        .in("status", [...OPEN])
        .limit(800);

      if (facilityIds != null && facilityIds.length > 0) {
        invQ = invQ.in("facility_id", facilityIds);
      }

      const invRes = (await invQ) as unknown as QueryListResult<RawInv>;
      if (invRes.error) throw invRes.error;
      let invs = invRes.data ?? [];

      let rq = supabase
        .from("residents" as never)
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", ["active", "hospital_hold", "loa"]);
      if (facilityIds != null && facilityIds.length > 0) {
        rq = rq.in("facility_id", facilityIds);
      }
      const rcount = (await rq) as unknown as { count: number | null; error: { message: string } | null };
      if (rcount.error) throw rcount.error;
      setResidentCount(rcount.count ?? 0);

      let iq = supabase
        .from("invoices" as never)
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null);
      if (facilityIds != null && facilityIds.length > 0) {
        iq = iq.in("facility_id", facilityIds);
      }
      const icount = (await iq) as unknown as { count: number | null; error: { message: string } | null };
      if (icount.error) throw icount.error;
      setAnyInvoiceCount(icount.count ?? 0);

      if (payerSelection.length > 0) {
        const allow = new Set(payerSelection);
        invs = invs.filter((i) => {
          const pt = (i.payer_type ?? "other") as PayerDb;
          return allow.has(pt);
        });
      }

      const uniqFids = [...new Set(invs.map((i) => i.facility_id))];
      const facMap: Record<string, string> = {};
      if (uniqFids.length > 0) {
        const fres = (await supabase
          .from("facilities" as never)
          .select("id, name")
          .in("id", uniqFids)) as unknown as QueryListResult<{ id: string; name: string }>;
        if (!fres.error && fres.data) {
          for (const f of fres.data) facMap[f.id] = f.name ?? "Facility";
        }
      }
      setFacilityNames(facMap);

      const resIds = [...new Set(invs.map((i) => i.resident_id))];
      const resMap: Record<string, string> = {};
      if (resIds.length > 0) {
        const rres = (await supabase
          .from("residents" as never)
          .select("id, first_name, last_name")
          .in("id", resIds)) as unknown as QueryListResult<{
          id: string;
          first_name: string | null;
          last_name: string | null;
        }>;
        if (!rres.error && rres.data) {
          for (const r of rres.data) {
            const fn = r.first_name?.trim() ?? "";
            const ln = r.last_name?.trim() ?? "";
            resMap[r.id] = `${fn} ${ln}`.trim() || "Resident";
          }
        }
      }
      setResidentNames(resMap);

      setRawInvoices(invs);
    } catch {
      setRawInvoices([]);
      setResidentCount(null);
      setAnyInvoiceCount(null);
      setFacilityNames({});
      setResidentNames({});
      setError("Could not load AR aging.");
    } finally {
      setIsLoading(false);
    }
  }, [facilitySelection, payerSelection, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const residentRollups: ResidentRollup[] = useMemo(() => {
    if (rawInvoices.length === 0) return [];
    const byRes = new Map<string, ResidentRollup>();
    for (const inv of rawInvoices) {
      const bal = Math.max(0, inv.balance_due);
      const days = daysPastDueAsOf(inv.due_date, asOfDate);
      const field = bucketIndexFromDays(days);
      const facilityId = inv.facility_id;
      const rn = residentNames[inv.resident_id] ?? "Resident";
      const cur =
        byRes.get(inv.resident_id) ??
        ({
          residentId: inv.resident_id,
          residentName: rn,
          facilityId,
          facilityName: facilityNames[facilityId] ?? "Facility",
          oldestDueIso: inv.due_date.slice(0, 10),
          totalCents: 0,
          b0_30: 0,
          b31_60: 0,
          b61_90: 0,
          b91: 0,
          counts: { b0_30: 0, b31_60: 0, b61_90: 0, b91: 0, total: 0 },
          invoices: [],
        } satisfies ResidentRollup);
      if (inv.due_date.slice(0, 10) < cur.oldestDueIso) cur.oldestDueIso = inv.due_date.slice(0, 10);
      cur.residentName = rn;
      cur.facilityId = facilityId;
      cur.facilityName = facilityNames[facilityId] ?? cur.facilityName;
      cur.totalCents += bal;
      cur[field] += bal;
      cur.counts[field] += 1;
      cur.counts.total += 1;
      cur.invoices.push(inv);
      byRes.set(inv.resident_id, cur);
    }
    return [...byRes.values()].sort((a, b) => b.totalCents - a.totalCents);
  }, [rawInvoices, asOfDate, residentNames, facilityNames]);

  const invoiceRows: InvoiceRollupRow[] = useMemo(() => {
    return rawInvoices.map((inv) => {
      const days = daysPastDueAsOf(inv.due_date, asOfDate);
      const cents = Math.max(0, inv.balance_due);
      return {
        ...inv,
        residentName: residentNames[inv.resident_id] ?? "Resident",
        facilityName: facilityNames[inv.facility_id] ?? "Facility",
        bucketDays: days,
        bucketAmountCents: cents,
      };
    });
  }, [rawInvoices, asOfDate, residentNames, facilityNames]);

  const totals = useMemo(() => {
    return rawInvoices.reduce(
      (acc, inv) => {
        const bal = Math.max(0, inv.balance_due);
        const days = daysPastDueAsOf(inv.due_date, asOfDate);
        const field = bucketIndexFromDays(days);
        acc[field] += bal;
        acc.total += bal;
        acc.counts[field] += 1;
        acc.counts.total += 1;
        return acc;
      },
      {
        total: 0,
        b0_30: 0,
        b31_60: 0,
        b61_90: 0,
        b91: 0,
        counts: { b0_30: 0, b31_60: 0, b61_90: 0, b91: 0, total: 0 },
      },
    );
  }, [rawInvoices, asOfDate]);

  const bucketField = bucketFieldFromUrl(bucketFilter);

  const filteredResidentRows = useMemo(() => {
    if (!bucketField) return residentRollups;
    return residentRollups.filter((r) => r[bucketField] > 0);
  }, [residentRollups, bucketField]);

  const filteredInvoiceRows = useMemo(() => {
    if (!bucketField) return invoiceRows;
    const f = bucketField;
    return invoiceRows.filter((inv) => {
      const days = daysPastDueAsOf(inv.due_date, asOfDate);
      const field = bucketIndexFromDays(days);
      return field === f;
    });
  }, [invoiceRows, bucketField, asOfDate]);

  const hasOpenAr = rawInvoices.length > 0;
  const showBucketStrip = hasOpenAr || !isLoading;

  const ninetyRatio = totals.total > 0 ? totals.b91 / totals.total : 0;
  const ninetyClass = ninetyPlusRiskShareClass(totals.total, totals.b91);

  const residentsSixtyPlusRisk = useMemo(() => {
    return residentRollups.filter((r) => r.b61_90 + r.b91 > 0).length;
  }, [residentRollups]);

  const facilityCountPhrase = useMemo(() => {
    const fid = effectiveFacilityFilterIds(selectedFacilityId, facilitySelection);
    if (fid != null) return fid.length === 1 ? "this facility" : `${fid.length} facilities`;
    const n = availableFacilities.length;
    return n === 1 ? "this facility" : `${n} facilities`;
  }, [selectedFacilityId, facilitySelection, availableFacilities.length]);

  const actionItemsVisible = hasOpenAr && (totals.b91 > 0 || residentsSixtyPlusRisk > 0 || totals.b31_60 > 0);

  const stackedSegments = useMemo(() => {
    if (totals.total <= 0) return [];
    return [
      { key: "b0_30", cents: totals.b0_30, label: "Current (0–30)", className: "bg-muted" },
      { key: "b31_60", cents: totals.b31_60, label: "31–60", className: "bg-amber-500/70" },
      { key: "b61_90", cents: totals.b61_90, label: "61–90", className: "bg-amber-600/80" },
      { key: "b91", cents: totals.b91, label: "90+", className: cn("bg-destructive/80", ninetyRatio > 0.05 && "ring-2 ring-destructive/50") },
    ].filter((s) => s.cents > 0);
  }, [totals, ninetyRatio]);

  const scopeSlugForExport = (() => {
    if (isValidFacilityIdForQuery(selectedFacilityId)) return `facility-${selectedFacilityId!.slice(0, 8)}`;
    if (facilitySelection.length === 0) return "all-facilities";
    return `${facilitySelection.length}-facilities`;
  })();

  const onExportCsv = () => {
    const lines: string[] = [];
    const header = [
      "Rollup",
      "Resident id",
      "Resident",
      "Facility",
      "Invoice #",
      "Due date",
      "Payer type",
      "Current_0_30_cents",
      "Bucket_31_60_cents",
      "Bucket_61_90_cents",
      "Bucket_91_plus_cents",
      "Total_open_cents",
    ];
    lines.push(header.map(csvEscape).join(","));

    if (rollupMode === "resident") {
      for (const r of filteredResidentRows) {
        lines.push(
          [
            "resident",
            r.residentId,
            r.residentName,
            r.facilityName,
            "",
            r.oldestDueIso,
            "",
            String(r.b0_30),
            String(r.b31_60),
            String(r.b61_90),
            String(r.b91),
            String(r.totalCents),
          ]
            .map((c) => csvEscape(String(c)))
            .join(","),
        );
      }
    } else {
      for (const inv of filteredInvoiceRows) {
        const days = daysPastDueAsOf(inv.due_date, asOfDate);
        const b0 = days <= 30 ? inv.balance_due : 0;
        const b31 = days > 30 && days <= 60 ? inv.balance_due : 0;
        const b61 = days > 60 && days <= 90 ? inv.balance_due : 0;
        const b91 = days > 90 ? inv.balance_due : 0;
        lines.push(
          [
            "invoice",
            inv.resident_id,
            inv.residentName,
            inv.facilityName,
            inv.invoice_number,
            inv.due_date.slice(0, 10),
            inv.payer_type ?? "",
            String(b0),
            String(b31),
            String(b61),
            String(b91),
            String(inv.balance_due),
          ]
            .map((c) => csvEscape(String(c)))
            .join(","),
        );
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ar-aging-${scopeSlugForExport}-as-of-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const emptyKind: "loading" | "error" | "no_residents" | "no_billing" | "paid_through" | null = (() => {
    if (isLoading) return "loading";
    if (error) return "error";
    if (!isLoading && rawInvoices.length > 0) return null;
    if (residentCount === 0) return "no_residents";
    if ((anyInvoiceCount ?? 0) === 0) return "no_billing";
    return "paid_through";
  })();

  const facilityToggle = (id: string) => {
    setFacilitySelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const payerToggle = (db: PayerDb) => {
    setPayerSelection((prev) => (prev.includes(db) ? prev.filter((x) => x !== db) : [...prev, db]));
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <BillingHubNav />

        <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">AR aging</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Outstanding balances grouped by days past due date. Paid, void, and zero-balance invoices are excluded.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <button
              type="button"
              onClick={onExportCsv}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium shadow-sm transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Download className="h-4 w-4" aria-hidden />
              Export aging
            </button>
            <div className="space-y-1">
              <label htmlFor="ar-aging-as-of" className="text-[13px] font-medium text-foreground">
                Aging as of
              </label>
              <DateInput
                id="ar-aging-as-of"
                value={asOfDate}
                onValueChange={(iso) => {
                  setAsOfDate(iso);
                  syncQueryParams({ asOf: iso });
                }}
                emptyHint={null}
                className="h-10 w-[11rem]"
              />
              <p className="text-[11px] text-muted-foreground">
                Snapshot uses invoice due dates versus this date. Historical ledger replay is a separate engine.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/10 p-4">
          {orgWideHub && availableFacilities.length > 1 ? (
            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium text-foreground">Facilities</legend>
              <p className="text-[12px] text-muted-foreground">
                Leave unchecked to include all facilities. Select one or more to narrow scope.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {availableFacilities.map((f) => (
                  <label key={f.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={facilitySelection.includes(f.id)}
                      onChange={() => facilityToggle(f.id)}
                      className="rounded border-input"
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-foreground">Payer type</legend>
            <p className="text-[12px] text-muted-foreground">Leave unchecked for all payer types.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {PAYER_OPTIONS.map(({ db, label }) => (
                <label key={db} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={payerSelection.includes(db)}
                    onChange={() => payerToggle(db)}
                    className="rounded border-input"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-foreground">Rollup</legend>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="rollup-ar-aging"
                  checked={rollupMode === "resident"}
                  onChange={() => setRollupMode("resident")}
                  className="border-input"
                />
                By resident
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="rollup-ar-aging"
                  checked={rollupMode === "invoice"}
                  onChange={() => setRollupMode("invoice")}
                  className="border-input"
                />
                By invoice
              </label>
            </div>
          </fieldset>
        </div>

        {bucketFilter ? (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-[13px] text-muted-foreground">
            Showing {rollupMode === "resident" ? "residents" : "invoices"} in{" "}
            <strong className="font-medium text-foreground">{BUCKET_LABELS[bucketFilter]}</strong>.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => syncQueryParams({ bucket: null })}
            >
              Clear bucket filter
            </button>
          </div>
        ) : null}

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {actionItemsVisible ? (
          <div className="space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/40 p-4 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-[13px] font-semibold text-foreground">Action items</p>
            <ul className="space-y-2 text-[13px] text-muted-foreground">
              {totals.b91 > 0 ? (
                <li>
                  <span className="text-warning">⚠</span> {billingCurrency.format(totals.b91 / 100)} at risk in 90+
                  day bucket · {totals.counts.b91} invoices ·{" "}
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => syncQueryParams({ bucket: "91-plus" })}
                  >
                    Review
                  </button>
                </li>
              ) : null}
              {residentsSixtyPlusRisk > 0 ? (
                <li>
                  <span className="text-warning">⚠</span> {residentsSixtyPlusRisk} residents with balance in 61+
                  day buckets ·{" "}
                  <Link href="/admin/billing/invoices" className="text-primary underline">
                    Review invoices
                  </Link>
                </li>
              ) : null}
              {totals.b31_60 > 0 ? (
                <li>
                  <span className="text-warning">⚠</span> {totals.counts.b31_60} invoices in 31–60 day bucket ·{" "}
                  <Link href="/admin/billing/collections" className="text-primary underline">
                    Run collections
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {showBucketStrip ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                {
                  key: "current" as const,
                  label: "Current (0–30)",
                  cents: totals.b0_30,
                  count: totals.counts.b0_30,
                },
                { key: "31-60" as const, label: "31–60 days past due", cents: totals.b31_60, count: totals.counts.b31_60 },
                { key: "61-90" as const, label: "61–90 days past due", cents: totals.b61_90, count: totals.counts.b61_90 },
                {
                  key: "91-plus" as const,
                  label: "90+ days past due",
                  cents: totals.b91,
                  count: totals.counts.b91,
                  emphasize: ninetyClass,
                },
                {
                  key: "all" as const,
                  label: "Total open",
                  cents: totals.total,
                  count: totals.counts.total,
                },
              ] as const
            ).map((tile) => {
              const active =
                tile.key === "all"
                  ? bucketFilter == null
                  : bucketFilter === tile.key;
              const amountDisplay = tile.cents > 0 ? billingCurrency.format(tile.cents / 100) : "—";
              const countDisplay = tile.count > 0 ? String(tile.count) : "—";
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => {
                    if (tile.key === "all") syncQueryParams({ bucket: null });
                    else syncQueryParams({ bucket: tile.key === bucketFilter ? null : tile.key });
                  }}
                  className={cn(
                    "rounded-[8px] border border-border bg-muted/10 p-4 text-left transition-colors",
                    "hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "ring-2 ring-primary/40",
                    tile.key === "91-plus" && totals.b91 > 0 && ninetyRatio > 0.05 && "border-destructive/50 bg-destructive/5",
                    tile.key === "91-plus" && totals.b91 > 0 && ninetyRatio <= 0.05 && "border-warning/40 bg-warning/5",
                  )}
                >
                  <p className="text-[12px] text-muted-foreground">{tile.label}</p>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                      tile.key === "91-plus" && totals.b91 > 0 ? ninetyClass : "text-foreground",
                    )}
                  >
                    {amountDisplay}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    {countDisplay === "—" ? "— invoices" : `${countDisplay} invoices`}
                  </p>
                </button>
              );
            })}
          </div>
        ) : null}

        {!isLoading && hasOpenAr ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">Distribution</p>
            {stackedSegments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-10 text-center text-[13px] text-muted-foreground">
                No bucket balances to chart for this scope.
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/10 p-4">
                <div
                  className="flex h-10 w-full overflow-hidden rounded-md"
                  role="img"
                  aria-label="Open AR distribution by aging bucket"
                >
                  {stackedSegments.map((s) => (
                    <div
                      key={s.key}
                      className={cn(s.className, "min-w-[4px] transition-[flex-grow]")}
                      style={{ flexGrow: Math.max(s.cents, 1), flexBasis: 0 }}
                      title={`${s.label}: ${billingCurrency.format(s.cents / 100)} · ${Math.round((s.cents / totals.total) * 100)}%`}
                    />
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  {stackedSegments.map((s) => (
                    <li key={s.key}>
                      <span className="font-medium text-foreground">{s.label}</span>:{" "}
                      {billingCurrency.format(s.cents / 100)} · {Math.round((s.cents / totals.total) * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}

        {!isLoading && emptyKind === "no_residents" ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8">
            <p className="text-[15px] font-semibold text-foreground">No residents in the selected scope</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Add residents to a facility to begin billing.{" "}
              <Link href="/admin/residents" className="text-primary underline">
                Go to Residents
              </Link>
            </p>
          </div>
        ) : null}

        {!isLoading && emptyKind === "no_billing" ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8">
            <p className="text-[15px] font-semibold text-foreground">
              No open AR — but {(residentCount ?? 0).toLocaleString()} resident{(residentCount ?? 0) === 1 ? "" : "s"} exist at{" "}
              {facilityCountPhrase}.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              This usually means billing has not generated invoices for the current period.{" "}
              <Link href="/admin/billing/invoices" className="text-primary underline">
                Review billing setup
              </Link>
            </p>
          </div>
        ) : null}

        {!isLoading && emptyKind === "paid_through" ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8">
            <p className="text-[15px] font-semibold text-foreground">No open AR</p>
            <p className="mt-2 text-sm text-muted-foreground">
              🎉 No open AR. All invoices in scope are paid, void, or zero-balance.
            </p>
          </div>
        ) : null}

        {!isLoading && hasOpenAr && rollupMode === "resident" && filteredResidentRows.length === 0 && bucketFilter ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6">
            <p className="text-[13px] font-semibold text-foreground">Nothing in this bucket</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Try another bucket or{" "}
              <button type="button" className="text-primary underline" onClick={() => syncQueryParams({ bucket: null })}>
                clear the filter
              </button>
              .
            </p>
          </div>
        ) : null}

        {!isLoading && hasOpenAr && rollupMode === "invoice" && filteredInvoiceRows.length === 0 && bucketFilter ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6">
            <p className="text-[13px] font-semibold text-foreground">Nothing in this bucket</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              <button type="button" className="text-primary underline" onClick={() => syncQueryParams({ bucket: null })}>
                Clear bucket filter
              </button>
            </p>
          </div>
        ) : null}

        {!isLoading && hasOpenAr && rollupMode === "resident" && filteredResidentRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-[12px] font-medium text-muted-foreground">
                  <th className="px-3 py-2"> </th>
                  <th className="px-3 py-2">Resident</th>
                  {orgWideHub ? <th className="px-3 py-2">Facility</th> : null}
                  <th className="px-3 py-2">Oldest invoice</th>
                  <th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">31–60</th>
                  <th className="px-3 py-2 text-right">61–90</th>
                  <th className="px-3 py-2 text-right">90+</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredResidentRows.map((r) => {
                  const open = expandedResidents.has(r.residentId);
                  return (
                    <React.Fragment key={r.residentId}>
                      <tr className="border-b border-border hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => toggleExpanded(r.residentId)}
                            className="rounded p-1 hover:bg-muted"
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">{r.residentName}</td>
                        {orgWideHub ? <td className="px-3 py-2 text-muted-foreground">{r.facilityName}</td> : null}
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.oldestDueIso}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatUsdCell(r.b0_30)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatUsdCell(r.b31_60)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatUsdCell(r.b61_90)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatUsdCell(r.b91)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{billingCurrency.format(r.totalCents / 100)}</td>
                        <td className="px-3 py-2 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Row actions</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onClick={() => router.push(`/admin/residents/${r.residentId}/billing`)}>
                                View resident billing
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled>Send reminder</DropdownMenuItem>
                              <DropdownMenuItem disabled>Mark paid</DropdownMenuItem>
                              <DropdownMenuItem disabled>Apply credit</DropdownMenuItem>
                              <DropdownMenuItem disabled>View payment history</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={orgWideHub ? 10 : 9} className="px-6 py-3">
                            <p className="mb-2 text-[12px] font-medium text-muted-foreground">Invoices ({r.invoices.length})</p>
                            <ul className="space-y-1 text-[12px]">
                              {r.invoices.map((inv) => (
                                <li key={inv.id} className="flex flex-wrap justify-between gap-2 tabular-nums">
                                  <span>
                                    <Link href={`/admin/billing/invoices/${inv.id}`} className="text-primary underline">
                                      {inv.invoice_number}
                                    </Link>{" "}
                                    <span className="text-muted-foreground">due {inv.due_date.slice(0, 10)}</span>
                                  </span>
                                  <span>{billingCurrency.format(inv.balance_due / 100)}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {!isLoading && hasOpenAr && rollupMode === "invoice" && filteredInvoiceRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-[12px] font-medium text-muted-foreground">
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Resident</th>
                  {orgWideHub ? <th className="px-3 py-2">Facility</th> : null}
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Open balance</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoiceRows.map((inv) => (
                  <tr key={inv.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <Link href={`/admin/billing/invoices/${inv.id}`} className="font-medium text-primary underline">
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{inv.residentName}</td>
                    {orgWideHub ? <td className="px-3 py-2 text-muted-foreground">{inv.facilityName}</td> : null}
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{inv.due_date.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {billingCurrency.format(inv.balance_due / 100)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => router.push(`/admin/residents/${inv.resident_id}/billing`)}>
                            View resident
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>Send reminder</DropdownMenuItem>
                          <DropdownMenuItem disabled>Mark paid</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <section className="space-y-3 rounded-lg border border-border bg-muted/5 p-5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
            Bucket trend (historical)
          </div>
          <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-12 text-center text-[13px] text-muted-foreground">
            Trend line charts appear when two or more months of stored aging snapshots exist. Monthly close snapshot engine is
            tracked separately.
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AdminArAgingPage() {
  return (
    <Suspense
      fallback={<div className="rounded-xl border border-border bg-card p-6 text-[13px] text-muted-foreground">Loading AR aging…</div>}
    >
      <AdminArAgingPageContent />
    </Suspense>
  );
}
