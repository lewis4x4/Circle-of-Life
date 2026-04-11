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
import {
  buildMonthlyInvoicePreview,
  getNextBillingMonth,
  monthLabel,
  persistMonthlyInvoicesFromPreview,
  type PreviewLine,
} from "@/lib/billing/generate-monthly-invoices";

import { BillingHubNav } from "../../billing-hub-nav";
import { billingCurrency } from "../../billing-invoice-ledger";
import { RateConfirmationBanner } from "@/components/billing/RateConfirmationBanner";

export default function AdminInvoiceGeneratePage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const defaultMonth = getNextBillingMonth();
  const [billingYear, setBillingYear] = useState(defaultMonth.year);
  const [billingMonth, setBillingMonth] = useState(defaultMonth.month);
  const billingLabel = monthLabel(billingYear, billingMonth);
  const days = useMemo(
    () =>
      new Date(billingYear, billingMonth, 0).getDate(),
    [billingYear, billingMonth],
  );

  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [meta, setMeta] = useState<{
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  }>({
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  });

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
      const result = await buildMonthlyInvoicePreview(supabase, {
        facilityId: selectedFacilityId,
        billingYear,
        billingMonth,
      });
      setPreview(result.preview);
      setError(result.error);
      setMeta({
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        dueDate: result.dueDate,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build preview.");
      setPreview([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId, billingYear, billingMonth]);

  useEffect(() => {
    void buildPreview();
  }, [buildPreview]);

  const grandTotal = preview.reduce((sum, l) => sum + l.total, 0);

  const handleGenerate = useCallback(async () => {
    if (preview.length === 0 || generating || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setGenerating(true);
    setError(null);

    try {
      const { createdCount } = await persistMonthlyInvoicesFromPreview(supabase, {
        facilityId: selectedFacilityId,
        billingYear,
        billingMonth,
        preview,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
        dueDate: meta.dueDate,
      });

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
    supabase,
    selectedFacilityId,
    meta,
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
      <RateConfirmationBanner facilityId={selectedFacilityId} />

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
