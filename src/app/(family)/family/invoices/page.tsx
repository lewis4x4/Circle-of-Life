"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import {
  fetchFamilyBillingContext,
  formatUsd,
  invoiceStatusBadgeClass,
  type FamilyBillingContext,
} from "@/lib/family/family-billing-data";
import {
  FAMILY_INVOICES_EMPTY_DESCRIPTION,
  FAMILY_INVOICES_EMPTY_TITLE,
  FAMILY_INVOICES_LOADING,
  FAMILY_INVOICES_PAGE_DESCRIPTION,
  FAMILY_INVOICES_PAGE_TITLE,
  FAMILY_INVOICES_RETRY,
} from "@/lib/family/family-portal-copy";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatDue(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function FamilyInvoicesPage() {
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
      const [invoiceResult, residentResult] = await Promise.all([
        fetchFamilyBillingContext(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!invoiceResult.ok) {
        setLoadError(invoiceResult.error);
        setData(null);
      } else {
        setData(invoiceResult.data);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load invoices.");
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
      <div className="mx-auto mt-20 max-w-lg rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {FAMILY_INVOICES_LOADING}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 pb-16 md:pb-0">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          {loadError}
        </div>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-auto min-h-[44px] border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
          onClick={() => void load()}
        >
          {FAMILY_INVOICES_RETRY}
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <FamilySectionIntro
        active="billing"
        title={FAMILY_INVOICES_PAGE_TITLE}
        description={FAMILY_INVOICES_PAGE_DESCRIPTION}
        residentSummary={residentSummary || undefined}
      />
      <Link
        href="/family/billing"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "inline-flex h-auto min-h-[44px] gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to billing summary
      </Link>

      {/* Warm split-theme: bg-muted on family/caregiver surfaces softens cards
          slightly compared to admin's stricter bg-card. */}
      <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
        <div className="mb-5 flex items-center gap-3">
          <FileText className="h-6 w-6 text-warning" />
          <div>
            <h2 className="text-2xl font-serif text-foreground">Invoices</h2>
            <p className="text-sm text-muted-foreground">
              Open balance across visible invoices:{" "}
              <span className="font-semibold text-foreground">{formatUsd(data.totalBalanceDue)}</span>
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {data.invoices.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="font-medium text-foreground">{FAMILY_INVOICES_EMPTY_TITLE}</p>
              <p className="mt-2 text-sm text-muted-foreground">{FAMILY_INVOICES_EMPTY_DESCRIPTION}</p>
            </div>
          ) : (
            data.invoices.map((inv) => (
              <div
                key={inv.id}
                className="min-h-[44px] rounded-lg border border-border bg-card p-5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {inv.invoiceNumber}
                    </p>
                    <p className="text-lg font-serif text-foreground">{inv.periodLabel}</p>
                  </div>
                  <Badge className={invoiceStatusBadgeClass(inv.status)}>{inv.statusLabel}</Badge>
                </div>
                <div className="space-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
                  <p>{inv.residentName}</p>
                  <p>
                    Total: <span className="tabular-nums text-foreground">{formatUsd(inv.total)}</span>
                  </p>
                  <p>
                    {inv.status === "paid"
                      ? "Paid in full"
                      : `Due ${formatDue(inv.dueDate)} · Balance ${formatUsd(inv.balanceDue)}`}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
