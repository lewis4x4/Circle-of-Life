"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { canOperateFacilityVendorWorkflow } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";
type FacilityMini = { id: string; name: string };
type VendorMini = { id: string; name: string };

type CreatePurchaseOrderRequest = {
  p_request_id: string; p_expected_caller: string; p_facility_id: string;
  p_vendor_id: string; p_order_date: string;
  p_lines: { description: string; quantity: number; unit_cost_cents: number }[];
};
type PurchaseOrderReceipt = {
  request_id: string; purchase_order_id: string; po_number: string;
  facility_id: string; vendor_id: string; total_cents: number; line_count: number;
};
// Narrow migration339's command locally until the generated schema is refreshed.
type PurchaseOrderCommandClient = {
  rpc(name: "create_purchase_order", args: CreatePurchaseOrderRequest): PromiseLike<{
    data: PurchaseOrderReceipt | null; error: { code: string; message: string } | null;
  }>;
};

// Decimal quantity * integer cents, rounded half up exactly as PostgreSQL numeric.
function lineTotalCents(quantity: string, unitCost: string): number {
  const [whole, fraction = ""] = quantity.split(".");
  const scaled = BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
  return Number((scaled * BigInt(unitCost) + BigInt(5000)) / BigInt(10000));
}

export default function NewPurchaseOrderPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { organizationId, appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const [facilities, setFacilities] = useState<FacilityMini[]>([]);
  const [vendors, setVendors] = useState<VendorMini[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineDesc, setLineDesc] = useState("Line 1");
  const [qty, setQty] = useState("1");
  const [unitCents, setUnitCents] = useState("1000");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const ambiguous = useRef(false);
  const request = useRef<CreatePurchaseOrderRequest | null>(null);
  const requestOrganization = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [{ data: fac }, { data: vend }] = await Promise.all([
      supabase.from("facilities").select("id, name").eq("organization_id", organizationId).is("deleted_at", null).order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", organizationId).is("deleted_at", null).order("name"),
    ]);
    setFacilities((fac ?? []) as FacilityMini[]);
    setVendors((vend ?? []) as VendorMini[]);
  }, [supabase, organizationId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const canSubmit = Boolean(organizationId && canOperateFacilityVendorWorkflow(role));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !canSubmit || !facilityId || !vendorId) return;
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setLoadError(null);
    try {
      if (!request.current && (!/^\d+(?:\.\d{1,4})?$/.test(qty) || Number(qty) <= 0 || Number(qty) >= 100000000
        || !/^\d+$/.test(unitCents) || Number(unitCents) > 2147483647
        || lineTotalCents(qty, unitCents) > 2147483647 || !lineDesc.trim() || !orderDate)) {
        throw new Error("Enter a description, a positive quantity with up to four decimal places, and nonnegative whole-cent costs within the supported range.");
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const actor = sessionData.session?.user.id;
      if (sessionError || !actor) throw new Error("Sign in with the original account to confirm this purchase order.");
      if (request.current && (request.current.p_expected_caller !== actor || requestOrganization.current !== organizationId)) {
        throw new Error("Return to the original account and organization to retry this purchase order.");
      }
      const args = request.current ?? {
        p_request_id: crypto.randomUUID(), p_expected_caller: actor, p_facility_id: facilityId,
        p_vendor_id: vendorId, p_order_date: orderDate,
        p_lines: [{ description: lineDesc.trim(), quantity: Number(qty), unit_cost_cents: Number(unitCents) }],
      };
      request.current = args;
      requestOrganization.current = organizationId;
      setPending(true);
      const { data, error } = await (supabase as unknown as PurchaseOrderCommandClient).rpc("create_purchase_order", args);
      if (error) {
        // Only the first definite transaction rollback permits corrected details.
        // A later denial cannot resolve an earlier lost response.
        if (!ambiguous.current && ["P0001", "42501", "23514", "23503", "22003", "22007", "22P02"].includes(error.code)) {
          request.current = null;
          requestOrganization.current = null;
          setPending(false);
        }
        throw error;
      }
      const receipt = data;
      if (!receipt?.purchase_order_id || !receipt.po_number || receipt.request_id !== args.p_request_id
        || receipt.facility_id !== args.p_facility_id || receipt.vendor_id !== args.p_vendor_id
        || receipt.line_count !== 1 || receipt.total_cents !== lineTotalCents(String(args.p_lines[0].quantity), String(args.p_lines[0].unit_cost_cents))) {
        throw new Error("The purchase order receipt could not be confirmed.");
      }
      router.push(`/admin/vendors/purchase-orders/${receipt.purchase_order_id}`);
    } catch (error) {
      if (request.current) ambiguous.current = true;
      const message = (error as { message?: string })?.message ?? "Purchase order is not confirmed.";
      setLoadError(message + (request.current
        ? " Retry the same request to confirm its outcome. Details are locked; keep this page open until confirmed."
        : " Nothing was created. Correct the details and try again."));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
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
              <fieldset disabled={pending || saving} className="space-y-4">
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
              </fieldset>
              <button
                type="submit"
                className={cn(buttonVariants())}
                disabled={saving || !facilityId || !vendorId}
              >
                {saving ? "Creating…" : pending ? "Retry same purchase order" : "Create draft PO"}
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
