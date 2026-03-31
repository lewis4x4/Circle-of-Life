"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../../billing-hub-nav";
import { billingCurrency } from "../../billing-invoice-ledger";

type Resident = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string;
  status: string;
  admission_date: string | null;
  facility_id: string;
  organization_id: string;
};

type RateSchedule = {
  id: string;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number;
  care_surcharge_level_2: number;
  care_surcharge_level_3: number;
};

type ResidentPayer = {
  resident_id: string;
  payer_type: string;
  payer_name: string | null;
};

type PreviewLine = {
  residentId: string;
  residentName: string;
  payerType: string;
  payerName: string;
  baseRate: number;
  careSurcharge: number;
  total: number;
  acuity: string;
  prorated: boolean;
};

type QueryError = { message: string };

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function getNextBillingMonth(): { year: number; month: number } {
  const now = new Date();
  const day = now.getDate();
  if (day >= 25) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { year: next.getFullYear(), month: next.getMonth() + 1 };
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function surchargeForAcuity(
  rate: RateSchedule,
  acuity: string,
): { cents: number; label: string } {
  switch (acuity) {
    case "level_1":
      return { cents: rate.care_surcharge_level_1, label: "Level 1" };
    case "level_2":
      return { cents: rate.care_surcharge_level_2, label: "Level 2" };
    case "level_3":
      return { cents: rate.care_surcharge_level_3, label: "Level 3" };
    default:
      return { cents: 0, label: "Unknown" };
  }
}

export default function AdminInvoiceGeneratePage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const defaultMonth = getNextBillingMonth();
  const [billingYear, setBillingYear] = useState(defaultMonth.year);
  const [billingMonth, setBillingMonth] = useState(defaultMonth.month);
  const billingLabel = monthLabel(billingYear, billingMonth);
  const days = daysInMonth(billingYear, billingMonth);

  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);

  const buildPreview = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setPreview([]);
      setLoading(false);
      setError("Select a facility to preview invoice generation.");
      return;
    }

    setLoading(true);
    setError(null);
    setGenerated(false);

    try {
      type QR<T> = { data: T | null; error: QueryError | null };

      const resP = supabase
        .from("residents" as never)
        .select(
          "id, first_name, last_name, acuity_level, status, admission_date, facility_id, organization_id",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("status", "active")
        .limit(200);

      const rateP = supabase
        .from("rate_schedules" as never)
        .select(
          "id, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .is("end_date", null)
        .order("effective_date", { ascending: false })
        .limit(1);

      const payerP = supabase
        .from("resident_payers" as never)
        .select("resident_id, payer_type, payer_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .is("end_date", null)
        .eq("is_primary", true);

      const existingP = supabase
        .from("invoices" as never)
        .select("resident_id")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq(
          "period_start",
          `${billingYear}-${String(billingMonth).padStart(2, "0")}-01`,
        )
        .limit(200);

      const [resResult, rateResult, payerResult, existingResult] =
        (await Promise.all([resP, rateP, payerP, existingP])) as unknown as [
          QR<Resident[]>,
          QR<RateSchedule[]>,
          QR<ResidentPayer[]>,
          QR<{ resident_id: string }[]>,
        ];

      if (resResult.error) throw resResult.error;
      if (rateResult.error) throw rateResult.error;
      if (payerResult.error) throw payerResult.error;

      const residents = resResult.data ?? [];
      const rate = (rateResult.data ?? [])[0];
      const payers = payerResult.data ?? [];
      const alreadyInvoiced = new Set(
        (existingResult.data ?? []).map((r) => r.resident_id),
      );

      if (!rate) {
        setError(
          "No active rate schedule found for this facility. Create one under Billing > Rates.",
        );
        setPreview([]);
        setLoading(false);
        return;
      }

      const payerMap = new Map(payers.map((p) => [p.resident_id, p]));

      const lines: PreviewLine[] = residents
        .filter((r) => !alreadyInvoiced.has(r.id))
        .map((r) => {
          const name =
            `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
              /^, |, $/,
              "",
            );
          const payer = payerMap.get(r.id);
          const baseRate = rate.base_rate_private;
          const surcharge = surchargeForAcuity(rate, r.acuity_level);

          let effectiveBase = baseRate;
          let prorated = false;
          if (r.admission_date) {
            const admDate = new Date(r.admission_date);
            const periodStart = new Date(billingYear, billingMonth - 1, 1);
            if (admDate > periodStart) {
              const daysPresent =
                days - admDate.getDate() + 1;
              effectiveBase = Math.round(
                (baseRate * daysPresent) / days,
              );
              prorated = true;
            }
          }

          return {
            residentId: r.id,
            residentName: name,
            payerType: payer?.payer_type ?? "private_pay",
            payerName: payer?.payer_name ?? "Responsible party",
            baseRate: effectiveBase,
            careSurcharge: surcharge.cents,
            total: effectiveBase + surcharge.cents,
            acuity: surcharge.label,
            prorated,
          };
        });

      setPreview(lines);
      if (alreadyInvoiced.size > 0 && lines.length === 0 && residents.length > 0) {
        setError(
          `All ${residents.length} residents already have invoices for ${billingLabel}. No new invoices to generate.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build preview.");
      setPreview([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId, billingYear, billingMonth, billingLabel, days]);

  useEffect(() => {
    void buildPreview();
  }, [buildPreview]);

  const grandTotal = preview.reduce((sum, l) => sum + l.total, 0);

  const handleGenerate = useCallback(async () => {
    if (preview.length === 0 || generating) return;
    setGenerating(true);
    setError(null);

    try {
      const periodStart = `${billingYear}-${String(billingMonth).padStart(2, "0")}-01`;
      const periodEnd = `${billingYear}-${String(billingMonth).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
      const dueDate = new Date(billingYear, billingMonth - 1, 15)
        .toISOString()
        .slice(0, 10);

      const facilityRow = (await supabase
        .from("facilities" as never)
        .select("entity_id, code")
        .eq("id", selectedFacilityId!)
        .maybeSingle()) as unknown as {
        data: { entity_id: string; code: string | null } | null;
        error: QueryError | null;
      };
      if (facilityRow.error) throw facilityRow.error;
      if (!facilityRow.data) throw new Error("Facility not found.");

      const entityId = facilityRow.data.entity_id;
      const facilityCode = facilityRow.data.code ?? "FAC";

      let createdCount = 0;

      for (let i = 0; i < preview.length; i++) {
        const line = preview[i];
        const seqNum = String(i + 1).padStart(3, "0");
        const invoiceNumber = `${facilityCode}-${billingYear}-${String(billingMonth).padStart(2, "0")}-${seqNum}`;

        const resRow = (await supabase
          .from("residents" as never)
          .select("organization_id")
          .eq("id", line.residentId)
          .maybeSingle()) as {
          data: { organization_id: string } | null;
          error: QueryError | null;
        };
        const orgId = resRow.data?.organization_id;
        if (!orgId) continue;

        const { data: invData, error: invErr } = (await supabase
          .from("invoices" as never)
          .insert({
            resident_id: line.residentId,
            facility_id: selectedFacilityId,
            organization_id: orgId,
            entity_id: entityId,
            invoice_number: invoiceNumber,
            invoice_date: periodStart,
            due_date: dueDate,
            period_start: periodStart,
            period_end: periodEnd,
            status: "draft",
            subtotal: line.total,
            adjustments: 0,
            tax: 0,
            total: line.total,
            amount_paid: 0,
            balance_due: line.total,
            payer_type: line.payerType,
            payer_name: line.payerName,
          } as never)
          .select("id")
          .single()) as {
          data: { id: string } | null;
          error: QueryError | null;
        };

        if (invErr) throw invErr;
        if (!invData) continue;

        const lineItems = [
          {
            invoice_id: invData.id,
            organization_id: orgId,
            line_type: "room_and_board",
            description: line.prorated
              ? `Private Room — Prorated (${billingLabel})`
              : `Private Room — Monthly Rate`,
            quantity: 1,
            unit_price: line.baseRate,
            total: line.baseRate,
            sort_order: 1,
          },
        ];

        if (line.careSurcharge > 0) {
          lineItems.push({
            invoice_id: invData.id,
            organization_id: orgId,
            line_type: "care_surcharge",
            description: `${line.acuity} Care Surcharge`,
            quantity: 1,
            unit_price: line.careSurcharge,
            total: line.careSurcharge,
            sort_order: 2,
          });
        }

        await supabase
          .from("invoice_line_items" as never)
          .insert(lineItems as never);

        createdCount++;
      }

      setGeneratedCount(createdCount);
      setGenerated(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to generate invoices.",
      );
    } finally {
      setGenerating(false);
    }
  }, [
    preview,
    generating,
    billingYear,
    billingMonth,
    billingLabel,
    days,
    supabase,
    selectedFacilityId,
  ]);

  if (generated) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <BillingHubNav />
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-lg text-emerald-900 dark:text-emerald-200">
                Invoices generated
              </CardTitle>
            </div>
            <CardDescription>
              {generatedCount} draft invoice{generatedCount !== 1 ? "s" : ""}{" "}
              created for {billingLabel}. Review and send from the invoice
              list.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link
              href="/admin/billing/invoices"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              View invoices
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setGenerated(false);
                void buildPreview();
              }}
            >
              Generate more
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />

      <div className="flex items-center gap-2">
        <Link
          href="/admin/billing/invoices"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex w-fit gap-1",
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <CardTitle className="text-xl">
                Generate invoices — {billingLabel}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={`${billingYear}-${billingMonth}`}
                onChange={(e) => {
                  const [y, m] = e.target.value.split("-").map(Number);
                  setBillingYear(y);
                  setBillingMonth(m);
                }}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {Array.from({ length: 6 }, (_, i) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() + i);
                  const y = d.getFullYear();
                  const m = d.getMonth() + 1;
                  return (
                    <option key={`${y}-${m}`} value={`${y}-${m}`}>
                      {monthLabel(y, m)}
                    </option>
                  );
                })}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  void buildPreview();
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Preview charges for active residents, then generate draft invoices.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Building preview…
            </div>
          ) : error && preview.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {error}
            </div>
          ) : preview.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No billable residents found for this facility and period.
            </p>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  {error}
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resident</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Acuity
                    </TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Surcharge</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((line) => (
                    <TableRow key={line.residentId}>
                      <TableCell className="font-medium">
                        {line.residentName}
                        {line.prorated && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px]"
                          >
                            Prorated
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                        <span className="capitalize">
                          {line.payerType.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-slate-600 dark:text-slate-400 sm:table-cell">
                        {line.acuity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {billingCurrency.format(line.baseRate / 100)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.careSurcharge > 0
                          ? billingCurrency.format(line.careSurcharge / 100)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {billingCurrency.format(line.total / 100)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {preview.length} resident{preview.length !== 1 ? "s" : ""} ·{" "}
                  {days} days in {billingLabel}
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {billingCurrency.format(grandTotal / 100)}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  disabled={generating}
                  onClick={() => {
                    void handleGenerate();
                  }}
                  className="min-w-[200px]"
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Generate {preview.length} draft invoice
                      {preview.length !== 1 ? "s" : ""}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
