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
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import type { Database } from "@/types/database";

type ContractRow = Database["public"]["Tables"]["contracts"]["Row"];

export default function VendorContractsListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<(ContractRow & { vendor_name?: string })[]>([]);
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
      .from("contracts")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("expiration_date", { ascending: true, nullsFirst: false });
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      const list = (data ?? []) as ContractRow[];
      const vids = [...new Set(list.map((r) => r.vendor_id))];
      const { data: vrows } = await supabase.from("vendors").select("id, name").in("id", vids);
      const vmap = new Map((vrows ?? []).map((v) => [v.id as string, v.name as string]));
      setRows(list.map((r) => ({ ...r, vendor_name: vmap.get(r.vendor_id) })));
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
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Contracts</h1>
            <p className="text-sm text-muted-foreground">Vendor agreements and key dates.</p>
          </div>
        </header>

        {loadError && (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        )}

        {loading ? (
          <AdminTableLoadingState />
        ) : rows.length === 0 && !loadError ? (
          <AdminEmptyState title="No contracts" description="Vendor contracts will appear here once entered." />
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            <TableRowHeader>
              <span className="flex-1 min-w-0">Title</span>
              <span className="w-[140px] shrink-0">Vendor</span>
              <span className="w-[110px] shrink-0">Effective</span>
              <span className="w-[110px] shrink-0">Expires</span>
              <span className="w-[110px] shrink-0 text-right">Value</span>
            </TableRowHeader>
            <MotionList className="space-y-1 p-1">
              {rows.map((r) => (
                <MotionItem key={r.id}>
                  <TableRow render={<Link href={`/admin/vendors/contracts/${r.id}`} />}>
                    <span className="flex-1 min-w-0 font-medium text-[13px] text-foreground truncate">
                      {r.title}
                    </span>
                    <span className="w-[140px] shrink-0 text-[12px] text-muted-foreground truncate">
                      {r.vendor_name ?? "—"}
                    </span>
                    <span className="w-[110px] shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                      {r.effective_date}
                    </span>
                    <span className="w-[110px] shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                      {r.expiration_date ?? "—"}
                    </span>
                    <span className="w-[110px] shrink-0 text-right font-mono text-[13px] font-medium text-foreground tabular-nums">
                      {formatUsdFromCents(r.total_value_cents)}
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
