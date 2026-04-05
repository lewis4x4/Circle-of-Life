"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { canFinalizeVendorInvoice } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type InvRow = Database["public"]["Tables"]["vendor_invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["vendor_invoice_lines"]["Row"];

export default function VendorInvoiceDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const [inv, setInv] = useState<InvRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setInv(null);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from("vendor_invoices")
      .select("*")
      .eq("id", id)
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !row) {
      setLoadError(error?.message ?? "Invoice not found.");
      setInv(null);
      setLoading(false);
      return;
    }
    setInv(row as InvRow);
    const { data: li } = await supabase
      .from("vendor_invoice_lines")
      .select("*")
      .eq("vendor_invoice_id", id)
      .is("deleted_at", null)
      .order("line_number");
    setLines((li ?? []) as LineRow[]);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function patchStatus(status: InvRow["status"], withApproval?: boolean) {
    if (!inv || !ctx?.ok) return;
    setSaving(true);
    setLoadError(null);
    const payload: Record<string, unknown> = { status };
    if (withApproval) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      payload.approved_by = user?.id ?? null;
      payload.approved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("vendor_invoices").update(payload).eq("id", inv.id);
    setSaving(false);
    if (error) setLoadError(error.message);
    else await load();
  }

  const canFinalize = ctx?.ok && canFinalizeVendorInvoice(ctx.ctx.appRole);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loading && !inv ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : inv ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{inv.invoice_number}</h1>
              <p className="text-sm capitalize text-slate-600 dark:text-slate-400">{inv.status}</p>
            </div>
            <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/vendors/invoices">
              Back
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow</CardTitle>
              <CardDescription>Org admin approves match after PO and receipt alignment.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {inv.status === "draft" && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void patchStatus("submitted")}
                >
                  Submit
                </button>
              )}
              {inv.status === "submitted" && canFinalize && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void patchStatus("approved", true)}
                >
                  Approve
                </button>
              )}
              {inv.status === "approved" && canFinalize && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void patchStatus("matched", true)}
                >
                  Mark matched
                </button>
              )}
              {inv.status === "matched" && canFinalize && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void patchStatus("paid")}
                >
                  Mark paid
                </button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>Invoice date: {inv.invoice_date}</p>
              <p>Due: {inv.due_date}</p>
              <p>Total: {formatUsdFromCents(inv.total_cents)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lines</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">Description</th>
                    <th className="pb-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-2 pr-4">{l.line_number}</td>
                      <td className="py-2 pr-4">{l.description}</td>
                      <td className="py-2">{formatUsdFromCents(l.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
