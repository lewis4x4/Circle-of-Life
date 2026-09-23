"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { billingCurrency } from "@/lib/billing/currency";
import { fetchRentRollFromSupabase, RENT_ROLL_NO_BED_COPY, type RentRollLoad } from "@/lib/billing/load-rent-roll";
import {
  parseRentRollPeriod,
  rentRollPeriodBounds,
  rentRollToCsv,
  shiftRentRollPeriod,
  type RentRollPeriod,
  type RentRollRow,
} from "@/lib/billing/rent-roll-model";
import { isNotYetSentStatus } from "@/lib/billing/receivables";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

import { BillingHubNav } from "../billing-hub-nav";
import { enumLabel } from "@/lib/display/enum-label";


function money(cents: number | null): string {
  return cents === null ? "" : billingCurrency.format(cents / 100);
}

function periodKey(period: RentRollPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function csvFilename(facilityName: string | null, key: string): string {
  const slug = (facilityName ?? "facility").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `rent-roll-${slug}-${key}.csv`;
}

function downloadCsv(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RentRollSummaryTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] ring-1 ring-border/60">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {caption ? <p className="mt-1 text-[12px] text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

function RowNotes({ row }: { row: RentRollRow }) {
  if (!row.collectionNote && row.flags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {row.collectionNote ? (
        <p className="text-foreground">
          <span className="tabular-nums text-muted-foreground">{row.collectionNote.date}</span> {row.collectionNote.text}
          {row.collectionNote.followUpDate ? (
            <span className="text-muted-foreground"> · follow up {row.collectionNote.followUpDate}</span>
          ) : null}
        </p>
      ) : null}
      {row.flags.map((flag) => (
        <p key={flag} className="text-muted-foreground">
          {flag}
        </p>
      ))}
    </div>
  );
}

function RentRollPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();

  const period = useMemo(() => parseRentRollPeriod(searchParams.get("period")), [searchParams]);
  const bounds = useMemo(() => rentRollPeriodBounds(period), [period]);
  const facilityScoped = isValidFacilityIdForQuery(selectedFacilityId);
  const facilityName = availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null;

  const [load, setLoad] = useState<RentRollLoad | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!facilityScoped) {
      setLoad(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      setLoad(await fetchRentRollFromSupabase(selectedFacilityId, period, supabase));
    } catch (err) {
      setLoad(null);
      setError(err instanceof Error ? err.message : "Could not load the rent roll.");
    } finally {
      setIsLoading(false);
    }
  }, [facilityScoped, period, selectedFacilityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const goToPeriod = useCallback(
    (next: RentRollPeriod) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", periodKey(next));
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const roll = load?.roll ?? null;
  const rows = roll?.rows ?? [];
  const totals = roll?.totals ?? null;
  const showOtherSource = rows.some((r) => r.otherSourceCents !== null);
  const paymentsRecorded = rows.some((r) => r.paidPrivatelyCents !== 0 || r.medicaidPaidCents !== 0);
  const draftInvoiceCount = rows.filter((r) => r.invoice && isNotYetSentStatus(r.invoice.status)).length;
  const invoicedCount = rows.filter((r) => r.invoice !== null).length;

  return (
    <div className="space-y-6">
      <BillingHubNav />

      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">Rent roll</h2>
            <p className="max-w-3xl text-[13px] text-muted-foreground">
              {facilityName ? `${facilityName} · ` : ""}
              {bounds.label}. One row per resident who was in the building at any point in the month: what the month is
              contracted at, split private versus Medicaid; what came in from each; and what is still outstanding.
              Medicaid is billed for the prior month&apos;s dates of service, so the Medicaid columns read{" "}
              {bounds.priorMonthLabel}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Previous month"
              onClick={() => goToPeriod(shiftRentRollPeriod(period, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-[10rem] text-center text-[13px] font-medium tabular-nums text-foreground">{bounds.label}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Next month"
              onClick={() => goToPeriod(shiftRentRollPeriod(period, 1))}
            >
              <ChevronRight />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!roll || rows.length === 0}
              onClick={() => roll && downloadCsv(rentRollToCsv(roll), csvFilename(facilityName, bounds.key))}
            >
              <Download data-icon="inline-start" />
              Download CSV
            </Button>
          </div>
        </header>

        {!facilityScoped ? (
          <div className="rounded-xl border border-border bg-card p-4 text-[13px] text-muted-foreground shadow-[var(--shadow-card)] ring-1 ring-border/60">
            The rent roll is kept per building, the way the office keeps it. Pick a facility in the header to open its month.
          </div>
        ) : null}

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void reload()} /> : null}

        {isLoading ? <AdminTableLoadingState /> : null}

        {!isLoading && roll && totals ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RentRollSummaryTile
                label="Total contracted"
                value={money(totals.contractedCents)}
                caption={
                  totals.rowsWithoutRate > 0
                    ? `${totals.residentCount} residents · ${totals.rowsWithoutRate} without a rate on file`
                    : `${totals.residentCount} residents`
                }
              />
              <RentRollSummaryTile
                label="Total collected"
                value={money(totals.collectedCents)}
                caption={`${money(totals.paidPrivatelyCents)} private · ${money(totals.medicaidPaidCents)} Medicaid`}
              />
              <RentRollSummaryTile label="Total outstanding" value={money(totals.outstandingCents)} />
              <RentRollSummaryTile
                label="Collection rate"
                value={totals.collectionRate === null ? "—" : `${Math.round(totals.collectionRate * 100)}%`}
                caption={totals.collectionRate === null ? "Nothing contracted this month" : "Collected ÷ contracted"}
              />
            </div>

            {rows.length > 0 && !paymentsRecorded ? (
              <p
                role="status"
                className="rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 text-[13px] text-foreground dark:border-amber-800 dark:bg-amber-950/20"
              >
                No payments are recorded in Haven for {facilityName ?? "this facility"} in {bounds.label}. The paid columns
                fill in as payments are recorded; until then, outstanding equals the contracted amount.
              </p>
            ) : null}

            {draftInvoiceCount > 0 ? (
              <p className="text-[13px] text-muted-foreground">
                {draftInvoiceCount} of the {invoicedCount} Haven invoices for {bounds.label} are still drafts. A draft is not
                billed; the contracted amount above comes from each resident&apos;s payer record, not the invoice.
              </p>
            ) : null}

            {rows.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-[13px] text-muted-foreground shadow-[var(--shadow-card)] ring-1 ring-border/60">
                No residents were in {facilityName ?? "this facility"} during {bounds.label}.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[1180px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-[12px] font-medium text-muted-foreground">
                      <th className="px-3 py-2">Room #</th>
                      <th className="px-3 py-2">Admit date</th>
                      <th className="px-3 py-2">Resident</th>
                      <th className="px-3 py-2 text-right">Total PVT &amp; MCD</th>
                      <th className="px-3 py-2 text-right">PVT</th>
                      {showOtherSource ? <th className="px-3 py-2 text-right">Other source</th> : null}
                      <th className="px-3 py-2 text-right">Paid privately</th>
                      <th className="px-3 py-2 text-right">Medicaid billed · DOS {bounds.priorMonthLabel}</th>
                      <th className="px-3 py-2 text-right">Medicaid paid · {bounds.priorMonthLabel}</th>
                      <th className="px-3 py-2 text-right">Outstanding</th>
                      <th className="px-3 py-2">Medicaid plan</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2">Admitted from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.residentId} className="border-b border-border align-top hover:bg-muted/20">
                        <td className="px-3 py-2 tabular-nums text-foreground">
                          {row.roomLabel ?? <span className="text-muted-foreground">{RENT_ROLL_NO_BED_COPY}</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.admissionDate ?? "—"}</td>
                        <td className="px-3 py-2 font-medium text-foreground">
                          <Link href={`/admin/residents/${row.residentId}/billing`} className="hover:underline">
                            {row.residentName}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.contractedCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.privateShareCents)}</td>
                        {showOtherSource ? (
                          <td className="px-3 py-2 text-right tabular-nums">{money(row.otherSourceCents)}</td>
                        ) : null}
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.paidPrivatelyCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.medicaidBilledCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.medicaidPaidCents)}</td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-medium tabular-nums",
                            row.outstandingCents !== null && row.outstandingCents > 0 ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {money(row.outstandingCents)}
                        </td>
                        <td className="px-3 py-2 text-foreground">
                          {row.medicaidPlan ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="max-w-[18rem] px-3 py-2 text-[12px]">
                          <RowNotes row={row} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.admittedFrom ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 text-[13px] font-semibold text-foreground">
                      <td className="px-3 py-2" colSpan={3}>
                        Totals · {totals.residentCount} residents
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.contractedCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.privateShareCents)}</td>
                      {showOtherSource ? <td className="px-3 py-2 text-right tabular-nums">{money(totals.otherSourceCents)}</td> : null}
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.paidPrivatelyCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.medicaidBilledCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.medicaidPaidCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(totals.outstandingCents)}</td>
                      <td className="px-3 py-2" colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {load && load.planRates.length > 0 ? (
              <div className="text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">Medicaid plan rates on file: </span>
                {load.planRates.map((plan, index) => (
                  <span key={plan.name}>
                    {index > 0 ? " · " : ""}
                    {plan.name} {money(plan.rateCents)}
                    {plan.rateUnit === "monthly" ? "" : ` per ${enumLabel(plan.rateUnit, { case: "lower" }).replace(/^per /, "")}`}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

export default function AdminBillingRentRollPage() {
  return (
    <Suspense fallback={<AdminTableLoadingState />}>
      <RentRollPageContent />
    </Suspense>
  );
}
