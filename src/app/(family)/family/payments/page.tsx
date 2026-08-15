"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Loader2 } from "lucide-react";

import { fetchFamilyPaymentsList, formatUsd, type FamilyPaymentRow } from "@/lib/family/family-billing-data";
import {
  FAMILY_PAYMENTS_EMPTY_DESCRIPTION,
  FAMILY_PAYMENTS_EMPTY_TITLE,
  FAMILY_PAYMENTS_LOADING,
  FAMILY_PAYMENTS_PAGE_DESCRIPTION,
  FAMILY_PAYMENTS_PAGE_TITLE,
  FAMILY_PAYMENTS_RETRY,
} from "@/lib/family/family-portal-copy";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function FamilyPaymentsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FamilyPaymentRow[]>([]);
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
      const [paymentsResult, residentResult] = await Promise.all([
        fetchFamilyPaymentsList(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!paymentsResult.ok) {
        setLoadError(paymentsResult.error);
        setRows([]);
      } else {
        setRows(paymentsResult.rows);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load payments.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {FAMILY_PAYMENTS_LOADING}
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
          {FAMILY_PAYMENTS_RETRY}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <FamilySectionIntro
        active="billing"
        title={FAMILY_PAYMENTS_PAGE_TITLE}
        description={FAMILY_PAYMENTS_PAGE_DESCRIPTION}
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

      {/* Warm split-theme: muted surface softens the family list compared to admin. */}
      <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
        <div className="mb-5 flex items-center gap-3">
          <Banknote className="h-6 w-6 text-warning" />
          <div>
            <h2 className="text-2xl font-serif text-foreground">Payments</h2>
            <p className="text-sm text-muted-foreground">
              Posted payments visible for linked residents. This page is for review only.
            </p>
          </div>
        </div>
        <div className="mb-4">
          <Badge
            variant="outline"
            className="border-success/30 bg-success/10 text-foreground"
          >
            Read-only history
          </Badge>
        </div>
        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="font-medium text-foreground">{FAMILY_PAYMENTS_EMPTY_TITLE}</p>
              <p className="mt-2 text-sm text-muted-foreground">{FAMILY_PAYMENTS_EMPTY_DESCRIPTION}</p>
            </div>
          ) : (
            rows.map((p) => (
              <div
                key={p.id}
                className="flex min-h-[44px] flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-lg font-serif tabular-nums text-foreground">{formatUsd(p.amount)}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.dateLabel} · {p.methodLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.residentName}</p>
                </div>
                <p className="text-xs text-muted-foreground sm:text-right">{p.reference}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
