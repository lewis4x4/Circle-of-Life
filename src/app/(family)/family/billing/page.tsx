"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, FileText, Loader2, ShieldCheck, Banknote } from "lucide-react";

import {
  formatFamilyLastPaymentAmount,
  formatFamilyLastPaymentDate,
} from "@/lib/family/family-billing-copy";
import {
  fetchFamilyBillingContext,
  formatUsd,
  type FamilyBillingContext,
} from "@/lib/family/family-billing-data";
import {
  FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION,
  FAMILY_BILLING_EMPTY_INVOICES_TITLE,
  FAMILY_BILLING_LOADING,
  FAMILY_BILLING_PAGE_DESCRIPTION,
  FAMILY_BILLING_PAGE_TITLE,
  FAMILY_BILLING_RETRY,
} from "@/lib/family/family-portal-copy";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { cn } from "@/lib/utils";

function formatDue(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

export default function FamilyBillingSummaryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FamilyBillingContext | null>(null);
  const [residentSummary, setResidentSummary] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    try {
      const [billingResult, residentResult] = await Promise.all([
        fetchFamilyBillingContext(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!billingResult.ok) {
        setLoadError(billingResult.error);
        setData(null);
      } else {
        setData(billingResult.data);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load billing.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="mx-auto mt-20 max-w-lg rounded-lg border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-48 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-warning" />
        <p className="text-sm font-medium tracking-wide">{FAMILY_BILLING_LOADING}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto mt-20 max-w-md space-y-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-foreground">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className={cn(
            "h-12 w-full rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
          onClick={() => void load()}
        >
          {FAMILY_BILLING_RETRY}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const recent = data.invoices.slice(0, 4);
  const balanceTone: "neutral" | "warning" | "success" = data.hasOverdue
    ? "warning"
    : data.totalBalanceDue > 0
      ? "warning"
      : "success";
  const accountStatus = data.hasOverdue
    ? "Overdue balance"
    : data.totalBalanceDue > 0
      ? "Balance due"
      : "In good standing";
  const accountTone: "neutral" | "warning" | "success" = data.hasOverdue
    ? "warning"
    : data.totalBalanceDue > 0
      ? "warning"
      : "success";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-8 pt-12 md:pt-20">
      <FamilySectionIntro
        active="billing"
        title={FAMILY_BILLING_PAGE_TITLE}
        description={FAMILY_BILLING_PAGE_DESCRIPTION}
        residentSummary={residentSummary || undefined}
      />

      <div className="w-full space-y-12">
        {/* Financial Overview Blocks */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SummaryBlock label="Open balance" value={formatUsd(data.totalBalanceDue)} tone={balanceTone} />
          <SummaryBlock label="Account status" value={accountStatus} tone={accountTone} />
          <SummaryBlock
            label="Last payment"
            value={formatFamilyLastPaymentAmount(data.lastPaymentAmount)}
            tone="muted"
          />
          <SummaryBlock
            label="Payment date"
            value={formatFamilyLastPaymentDate(data.lastPaymentDateLabel)}
            tone="muted"
          />
        </div>

        {/* Invoices — warm split-theme uses bg-muted to soften the panel */}
        <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
          <h2 className="mb-6 flex items-center gap-2 font-serif text-2xl tracking-tight text-foreground">
            Recent Invoices
          </h2>

          {recent.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="font-medium text-foreground">{FAMILY_BILLING_EMPTY_INVOICES_TITLE}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((invoice) => (
                <div
                  key={invoice.id}
                  className="min-h-[44px] rounded-lg border border-border bg-card p-5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="mb-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {invoice.invoiceNumber}
                      </p>
                      <p className="font-serif text-lg text-foreground">{invoice.periodLabel}</p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider",
                        invoice.status === "paid"
                          ? "border-success/30 bg-success/10 text-foreground"
                          : "border-warning/30 bg-warning/10 text-foreground",
                      )}
                    >
                      {invoice.statusLabel}
                    </span>
                  </div>
                  <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                    <p className="font-serif text-2xl tabular-nums tracking-tight text-foreground">
                      {formatUsd(invoice.total)}
                    </p>
                    <p
                      className={cn(
                        "text-sm font-medium",
                        invoice.status === "paid" ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {invoice.status === "paid" ? "Paid" : `Due ${formatDue(invoice.dueDate)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Visibility scope footer */}
        <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              What you can do here
            </p>
          </div>
          <p className="mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
            This space is read-only today. You can review statements and payment history here, then follow your
            facility&apos;s existing payment path if something is due.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/family/invoices"
              className={cn(
                "inline-flex h-12 min-w-[140px] flex-1 items-center justify-center rounded-lg border border-border bg-card font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
            >
              <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
              View Invoices
            </Link>
            <Link
              href="/family/payments"
              className={cn(
                "inline-flex h-12 min-w-[140px] flex-1 items-center justify-center rounded-lg bg-primary font-medium text-primary-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              View Payments
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "muted" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning/10 border-warning/30"
      : tone === "success"
        ? "bg-success/10 border-success/30"
        : "bg-card border-border";

  return (
    <div className={cn("rounded-lg border p-6", toneClass)}>
      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-serif text-2xl tracking-tight text-foreground md:text-3xl">{value}</p>
    </div>
  );
}
