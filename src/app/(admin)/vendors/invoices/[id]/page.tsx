"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { canFinalizeVendorInvoice } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type InvRow = Database["public"]["Tables"]["vendor_invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["vendor_invoice_lines"]["Row"];

export default function VendorInvoiceDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { organizationId, appRole, user } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const [inv, setInv] = useState<InvRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    if (!organizationId) {
      setInv(null);
      setLoadError("Organization missing on profile.");
      setLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from("vendor_invoices")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
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
  }, [supabase, id, organizationId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function patchStatus(status: InvRow["status"], withApproval?: boolean) {
    if (!inv || !organizationId) return;
    setSaving(true);
    setLoadError(null);
    const payload: Record<string, unknown> = { status };
    if (withApproval) {
      payload.approved_by = user?.id ?? null;
      payload.approved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("vendor_invoices").update(payload).eq("id", inv.id);
    setSaving(false);
    if (error) setLoadError(error.message);
    else await load();
  }

  const canFinalize = Boolean(organizationId && canFinalizeVendorInvoice(role));

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}
      {loading && !inv ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : inv ? (
        <>
          <RecordDetailHeader
            title={inv.invoice_number}
            subtitle={inv.status}
            backLink={{ label: "Back to invoices", href: "/admin/vendors/invoices" }}
          />

          <RecordDetailSection
            title="Workflow"
            description="Org admin approves match after PO and receipt alignment."
          >
            <div className="flex flex-wrap gap-2">
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
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Totals">
            <div className="text-sm">
              <p>Invoice date: {inv.invoice_date}</p>
              <p>Due: {inv.due_date}</p>
              <p>
                Total: <span className="tabular-nums">{formatUsdFromCents(inv.total_cents)}</span>
              </p>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Lines">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">Description</th>
                    <th className="pb-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 tabular-nums">{l.line_number}</td>
                      <td className="py-2 pr-4">{l.description}</td>
                      <td className="py-2 tabular-nums">{formatUsdFromCents(l.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RecordDetailSection>
        </>
      ) : null}
    </div>
  );
}
