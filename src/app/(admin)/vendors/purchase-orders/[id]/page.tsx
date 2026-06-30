"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { canApprovePurchaseOrder } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type PoRow = Database["public"]["Tables"]["purchase_orders"]["Row"];
type LineRow = Database["public"]["Tables"]["po_line_items"]["Row"];

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { organizationId, appRole, user } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const [po, setPo] = useState<PoRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    if (!organizationId) {
      setPo(null);
      setLoadError("Organization missing on profile.");
      setLoading(false);
      return;
    }
    const { data: p, error: pe } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (pe || !p) {
      setLoadError(pe?.message ?? "PO not found.");
      setPo(null);
      setLoading(false);
      return;
    }
    setPo(p as PoRow);
    const { data: li } = await supabase
      .from("po_line_items")
      .select("*")
      .eq("purchase_order_id", id)
      .is("deleted_at", null)
      .order("line_number");
    setLines((li ?? []) as LineRow[]);
    setLoading(false);
  }, [supabase, id, organizationId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function setStatus(status: PoRow["status"], opts?: { approved?: boolean }) {
    if (!po || !organizationId) return;
    setSaving(true);
    setLoadError(null);
    const payload: Record<string, unknown> = { status };
    if (opts?.approved) {
      payload.approved_by = user?.id ?? null;
      payload.approved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("purchase_orders").update(payload).eq("id", po.id);
    setSaving(false);
    if (error) setLoadError(error.message);
    else await load();
  }

  async function saveReceived(line: LineRow) {
    const rq = Number.parseFloat((document.getElementById(`rq-${line.id}`) as HTMLInputElement)?.value ?? "0");
    setSaving(true);
    setLoadError(null);
    const { error } = await supabase
      .from("po_line_items")
      .update({ received_quantity: rq })
      .eq("id", line.id);
    setSaving(false);
    if (error) setLoadError(error.message);
    else await load();
  }

  const canApprove = Boolean(organizationId && canApprovePurchaseOrder(role));

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}
      {loading && !po ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : po ? (
        <>
          <RecordDetailHeader
            title={po.po_number}
            subtitle={po.status.replace(/_/g, " ")}
            backLink={{ label: "Back to purchase orders", href: "/admin/vendors/purchase-orders" }}
          />

          <RecordDetailSection
            title="Workflow"
            description="Submit for approval, approve as org admin, then record receipts."
          >
            <div className="flex flex-wrap gap-2">
              {po.status === "draft" && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void setStatus("submitted")}
                >
                  Submit
                </button>
              )}
              {po.status === "submitted" && canApprove && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void setStatus("approved", { approved: true })}
                >
                  Approve
                </button>
              )}
              {(po.status === "approved" || po.status === "partially_received") && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm" }))}
                  disabled={saving}
                  onClick={() => void setStatus("received")}
                >
                  Mark received
                </button>
              )}
              {po.status === "received" && canApprove && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                  disabled={saving}
                  onClick={() => void setStatus("closed")}
                >
                  Close PO
                </button>
              )}
              {canApprove && po.status !== "cancelled" && po.status !== "closed" && (
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "sm", variant: "destructive" }))}
                  disabled={saving}
                  onClick={() => void setStatus("cancelled")}
                >
                  Cancel
                </button>
              )}
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Summary">
            <div className="space-y-1 text-sm">
              <p>Order date: {po.order_date}</p>
              <p>
                Total: <span className="tabular-nums">{formatUsdFromCents(po.total_cents)}</span>
              </p>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Line items">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">Description</th>
                    <th className="pb-2 pr-4 font-medium">Qty</th>
                    <th className="pb-2 pr-4 font-medium">Received</th>
                    <th className="pb-2 font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 tabular-nums">{l.line_number}</td>
                      <td className="py-2 pr-4">{l.description}</td>
                      <td className="py-2 pr-4 tabular-nums">{l.quantity}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <Input
                            id={`rq-${l.id}`}
                            className="h-8 w-24"
                            defaultValue={l.received_quantity}
                            inputMode="decimal"
                          />
                          <button
                            type="button"
                            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                            disabled={saving}
                            onClick={() => void saveReceived(l)}
                          >
                            Save
                          </button>
                        </div>
                      </td>
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
