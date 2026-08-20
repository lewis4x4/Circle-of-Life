"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { formatInvoiceRowNumberForDisplay } from "@/lib/billing/invoices-display-copy";
import { postInvoiceToGl } from "@/lib/finance/post-to-gl";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import type { Database } from "@/types/database";

import { BillingHubNav } from "../../billing-hub-nav";
import {
  InvoiceStatusBadge,
  PayerTypeBadge,
  billingCurrency,
  mapDbInvoiceStatusToUi,
  mapDbPayerTypeToUi,
} from "../../billing-invoice-ledger";

type SupabaseInvoice = {
  id: string;
  resident_id: string;
  facility_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  status: string;
  subtotal: number;
  adjustments: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  payer_type: string | null;
  payer_name: string | null;
  notes: string | null;
  deleted_at: string | null;
};

type SupabaseLine = {
  id: string;
  description: string;
  line_type: string;
  quantity: number | string;
  unit_price: number;
  total: number;
  sort_order: number;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function AdminInvoiceDetailPage() {
  const params = useParams();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const id = UUID_STRING_RE.test(rawId) ? rawId : "";
  const { selectedFacilityId } = useFacilityStore();
  const { appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;

  const [invoice, setInvoice] = useState<SupabaseInvoice | null>(null);
  const [lines, setLines] = useState<SupabaseLine[]>([]);
  const [residentName, setResidentName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [glPosting, setGlPosting] = useState(false);
  const [glResult, setGlResult] = useState<{ journalEntryId: string; alreadyPosted?: boolean } | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [canPost, setCanPost] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const supabase = createClient();
      const invRes = (await supabase
        .from("invoices" as never)
        .select(
          "id, resident_id, facility_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type, payer_name, notes, deleted_at",
        )
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<SupabaseInvoice>;

      if (invRes.error) throw invRes.error;
      const inv = invRes.data;

      if (!inv) {
        setNotFound(true);
        return;
      }

      if (isValidFacilityIdForQuery(selectedFacilityId) && inv.facility_id !== selectedFacilityId) {
        setNotFound(true);
        return;
      }

      const lineRes = (await supabase
        .from("invoice_line_items" as never)
        .select("id, description, line_type, quantity, unit_price, total, sort_order")
        .eq("invoice_id", id)
        .order("sort_order", { ascending: true })) as unknown as QueryListResult<SupabaseLine>;
      if (lineRes.error) throw lineRes.error;

      const resRes = (await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .eq("id", inv.resident_id)
        .maybeSingle()) as unknown as QueryResult<SupabaseResidentMini>;
      if (resRes.error) throw resRes.error;
      const r = resRes.data;
      const fn = r?.first_name?.trim() ?? "";
      const ln = r?.last_name?.trim() ?? "";
      setResidentName(`${fn} ${ln}`.trim() || "Resident");

      setInvoice(inv);
      setLines(lineRes.data ?? []);

      if (canMutateFinance(role)) {
        setCanPost(true);
        const existingJe = await supabase
          .from("journal_entries")
          .select("id")
          .eq("source_type", "invoice")
          .eq("source_id", inv.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingJe.data) {
          setGlResult({ journalEntryId: existingJe.data.id, alreadyPosted: true });
        }
      }
    } catch (err) {
      setError(formatLiveDataLoadError(err, "Could not load this invoice."));
      setInvoice(null);
      setLines([]);
    } finally {
      setIsLoading(false);
    }
  }, [id, role, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!id || notFound) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <RecordDetailSection title="Invoice not found">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Check the link or your facility selection.</p>
            <Link href="/admin/billing/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Back to invoices
            </Link>
          </div>
        </RecordDetailSection>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <AdminTableLoadingState />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <AdminLiveDataFallbackNotice
          message={error ?? "Unknown error."}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  async function postToGl() {
    if (!invoice) return;
    setGlPosting(true);
    setGlError(null);
    try {
      const supabase = createClient();
      const result = await postInvoiceToGl(supabase, invoice.id);
      if (result.ok) {
        setGlResult({ journalEntryId: result.journalEntryId, alreadyPosted: result.alreadyPosted });
      } else {
        setGlError(result.error);
      }
    } finally {
      setGlPosting(false);
    }
  }

  const uiStatus = mapDbInvoiceStatusToUi(invoice.status);
  const uiPayer = mapDbPayerTypeToUi(invoice.payer_type);

  return (
    <div className="space-y-6">
      <BillingHubNav />

      <RecordDetailHeader
        title={formatInvoiceRowNumberForDisplay(invoice)}
        subtitle={`${residentName} · Period ${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}`}
        statusChips={
          <>
            <InvoiceStatusBadge status={uiStatus} />
            <PayerTypeBadge payerType={uiPayer} />
          </>
        }
        backLink={{ label: "Back to invoices", href: "/admin/billing/invoices" }}
        actions={
          <Link
            href={`/admin/residents/${invoice.resident_id}/billing`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Resident billing profile
          </Link>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <RecordDetailSection title="Timeline & parties">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Invoice date</dt>
              <dd className="font-medium tabular-nums text-foreground">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Due</dt>
              <dd className="font-medium tabular-nums text-foreground">{formatDate(invoice.due_date)}</dd>
            </div>
            {invoice.payer_name && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Payer on file</dt>
                <dd className="font-medium text-foreground">{invoice.payer_name}</dd>
              </div>
            )}
          </dl>
        </RecordDetailSection>

        <RecordDetailSection title="Totals">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{billingCurrency.format(invoice.subtotal / 100)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Adjustments</dt>
              <dd className="tabular-nums">{billingCurrency.format(invoice.adjustments / 100)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground pb-2">
              <dt>Tax</dt>
              <dd className="tabular-nums">{billingCurrency.format(invoice.tax / 100)}</dd>
            </div>
            <div className="border-t border-border pt-2" />
            <div className="flex justify-between font-medium text-foreground">
              <dt>Total</dt>
              <dd className="tabular-nums">{billingCurrency.format(invoice.total / 100)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Amount paid</dt>
              <dd className="tabular-nums">{billingCurrency.format(invoice.amount_paid / 100)}</dd>
            </div>
            <div className="border-t border-border pt-2" />
            <div className="flex justify-between font-semibold text-foreground">
              <dt>Balance due</dt>
              <dd className="tabular-nums">{billingCurrency.format(Math.max(0, invoice.balance_due) / 100)}</dd>
            </div>
          </dl>
        </RecordDetailSection>
      </div>

      {invoice.notes?.trim() && (
        <RecordDetailSection title="Notes">
          <p className="text-sm text-foreground">{invoice.notes.trim()}</p>
        </RecordDetailSection>
      )}

      <RecordDetailSection title="Line items" description="Charges comprising this invoice">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items returned.</p>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-[2fr_1fr_0.5fr_1fr_1fr] gap-4 pb-2 border-b border-border">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Description</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Type</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Qty</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Unit</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Total</div>
            </div>
            <MotionList className="space-y-2 mt-2">
              {lines.map((line) => (
                <MotionItem key={line.id}>
                  <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_0.5fr_1fr_1fr] gap-4 sm:items-center rounded-[8px] border border-border bg-card p-[14px] transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:-translate-y-0.5">
                    <div className="flex flex-col">
                      <span className="sm:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Description</span>
                      <span className="font-medium text-sm text-foreground">{line.description}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="sm:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Type</span>
                      <span className="text-xs font-mono tracking-wider text-muted-foreground uppercase">{line.line_type}</span>
                    </div>
                    <div className="flex flex-col sm:items-end">
                      <span className="sm:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Qty</span>
                      <span className="text-sm tabular-nums text-foreground">{Number(line.quantity)}</span>
                    </div>
                    <div className="flex flex-col sm:items-end">
                      <span className="sm:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Unit</span>
                      <span className="text-sm tabular-nums text-foreground">{billingCurrency.format(line.unit_price / 100)}</span>
                    </div>
                    <div className="flex flex-col sm:items-end">
                      <span className="sm:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Total</span>
                      <span className="text-sm tabular-nums font-semibold text-foreground">{billingCurrency.format(line.total / 100)}</span>
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </>
        )}
      </RecordDetailSection>

      {canPost && (
        <RecordDetailSection
          title="General ledger"
          description="Post this invoice to the GL as a balanced journal entry (Debit AR / Credit Revenue)."
        >
          <div className="space-y-4 max-w-xl">
            {glError && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 border border-destructive/30 rounded-[8px]" role="alert">
                {glError}
              </p>
            )}
            {glResult ? (
              <div className="flex flex-wrap items-center gap-4 rounded-[8px] border border-success/20 bg-success/10 p-[14px]">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-success mb-1">Status</span>
                  <span className="text-sm text-success">
                    {glResult.alreadyPosted ? "Reconciliation confirmed. Previously posted to GL." : "Commit successful. Posted to GL."}
                  </span>
                </div>
                <Link
                  href={`/admin/finance/journal-entries/${glResult.journalEntryId}`}
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "ml-auto")}
                >
                  View journal entry
                </Link>
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => void postToGl()}
                disabled={glPosting || invoice.total <= 0}
              >
                {glPosting ? "Posting…" : "Post to GL"}
              </Button>
            )}
          </div>
        </RecordDetailSection>
      )}
    </div>
  );
}
