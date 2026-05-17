"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VendorHubNav } from "../vendor-hub-nav";
import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import type { Database } from "@/types/database";

type InvRow = Database["public"]["Tables"]["vendor_invoices"]["Row"];

type InvoiceTone = "muted" | "warning" | "danger";

function invoiceStatusTone(status: string): InvoiceTone {
  if (status === "rejected") return "danger";
  if (status === "pending") return "warning";
  return "muted";
}

export default function VendorInvoicesPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    if (!c.ok) {
      setRows([]);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("vendor_invoices")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("invoice_date", { ascending: false });
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as InvRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <VendorHubNav />

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Vendor invoices</h1>
            <p className="text-sm text-muted-foreground">Three-way match and AP intake.</p>
          </div>
        </header>

        {loadError && (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        )}

        {loading ? (
          <AdminTableLoadingState />
        ) : rows.length === 0 && !loadError ? (
          <AdminEmptyState title="No vendor invoices" description="Vendor invoices will appear here once entered." />
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            <TableRowHeader>
              <span className="w-[140px] shrink-0">Invoice #</span>
              <span className="w-[100px] shrink-0">Status</span>
              <span className="w-[110px] shrink-0">Date</span>
              <span className="flex-1">Total</span>
            </TableRowHeader>
            <MotionList className="space-y-1 p-1">
              {rows.map((r) => (
                <MotionItem key={r.id}>
                  <TableRow render={<Link href={`/admin/vendors/invoices/${r.id}`} />}>
                    <span className="w-[140px] shrink-0 font-mono text-[12px] text-foreground font-medium truncate">
                      {r.invoice_number}
                    </span>
                    <span className="w-[100px] shrink-0">
                      <StatusPill tone={invoiceStatusTone(r.status)}>{r.status}</StatusPill>
                    </span>
                    <span className="w-[110px] shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                      {r.invoice_date}
                    </span>
                    <span className="flex-1 font-mono text-[13px] font-medium text-foreground tabular-nums">
                      {formatUsdFromCents(r.total_cents)}
                    </span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        )}
      </div>
    </div>
  );
}
