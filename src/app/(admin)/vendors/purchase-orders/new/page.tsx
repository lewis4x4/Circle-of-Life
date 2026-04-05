"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VendorHubNav } from "../../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { canOperateFacilityVendorWorkflow } from "@/lib/vendors/vendor-role-helpers";
type FacilityMini = { id: string; name: string };
type VendorMini = { id: string; name: string };

export default function NewPurchaseOrderPage() {
  const supabase = createClient();
  const [facilities, setFacilities] = useState<FacilityMini[]>([]);
  const [vendors, setVendors] = useState<VendorMini[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineDesc, setLineDesc] = useState("Line 1");
  const [qty, setQty] = useState("1");
  const [unitCents, setUnitCents] = useState("1000");
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setLoadError(c.error);
      return;
    }
    const [{ data: fac }, { data: vend }] = await Promise.all([
      supabase.from("facilities").select("id, name").eq("organization_id", c.ctx.organizationId).is("deleted_at", null).order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", c.ctx.organizationId).is("deleted_at", null).order("name"),
    ]);
    setFacilities((fac ?? []) as FacilityMini[]);
    setVendors((vend ?? []) as VendorMini[]);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const canSubmit = ctx?.ok && canOperateFacilityVendorWorkflow(ctx.ctx.appRole);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx?.ok || !canSubmit || !facilityId || !vendorId) return;
    setSaving(true);
    setLoadError(null);

    const { data: vf, error: vfe } = await supabase
      .from("vendor_facilities")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (vfe || !vf) {
      setLoadError("Link this vendor to the selected facility first (vendor profile).");
      setSaving(false);
      return;
    }

    const { data: poNum, error: rpcErr } = await supabase.rpc("allocate_vendor_po_number", {
      p_organization_id: ctx.ctx.organizationId,
    });
    if (rpcErr || !poNum) {
      setLoadError(rpcErr?.message ?? "Could not allocate PO number.");
      setSaving(false);
      return;
    }

    const q = Number.parseFloat(qty) || 1;
    const uc = Number.parseInt(unitCents, 10) || 0;
    const lineTotal = Math.round(q * uc);

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        organization_id: ctx.ctx.organizationId,
        vendor_id: vendorId,
        facility_id: facilityId,
        po_number: poNum,
        status: "draft",
        order_date: orderDate,
        total_cents: lineTotal,
      })
      .select("id")
      .single();
    if (poErr || !po) {
      setLoadError(poErr?.message ?? "Could not create PO.");
      setSaving(false);
      return;
    }

    const { error: liErr } = await supabase.from("po_line_items").insert({
      organization_id: ctx.ctx.organizationId,
      purchase_order_id: po.id,
      line_number: 1,
      description: lineDesc || "Line 1",
      quantity: q,
      unit_cost_cents: uc,
      line_total_cents: lineTotal,
    });
    setSaving(false);
    if (liErr) {
      setLoadError(liErr.message);
      return;
    }
    window.location.href = `/admin/vendors/purchase-orders/${po.id}`;
  }

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">New purchase order</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Creates a draft PO with one line item.</p>
        </div>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/vendors/purchase-orders">
          Back to list
        </Link>
      </div>

      {canSubmit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO header & line</CardTitle>
            <CardDescription>PO numbers are allocated by year (org-scoped).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="max-w-lg space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fac">Facility</Label>
                <select
                  id="fac"
                  required
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={facilityId}
                  onChange={(ev) => setFacilityId(ev.target.value)}
                >
                  <option value="">Select facility…</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ven">Vendor</Label>
                <select
                  id="ven"
                  required
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={vendorId}
                  onChange={(ev) => setVendorId(ev.target.value)}
                >
                  <option value="">Select vendor…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="od">Order date</Label>
                <Input id="od" type="date" value={orderDate} onChange={(ev) => setOrderDate(ev.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ld">Line description</Label>
                <Input id="ld" value={lineDesc} onChange={(ev) => setLineDesc(ev.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qty">Quantity</Label>
                  <Input id="qty" value={qty} onChange={(ev) => setQty(ev.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uc">Unit cost (cents)</Label>
                  <Input id="uc" value={unitCents} onChange={(ev) => setUnitCents(ev.target.value)} inputMode="numeric" />
                </div>
              </div>
              <button
                type="submit"
                className={cn(buttonVariants())}
                disabled={saving || !facilityId || !vendorId}
              >
                {saving ? "Creating…" : "Create draft PO"}
              </button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-600">You do not have access to create purchase orders.</p>
      )}
    </div>
  );
}
