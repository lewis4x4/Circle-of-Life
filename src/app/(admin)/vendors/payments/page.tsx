"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { VENDOR_PAYMENTS_LIST_SELECT } from "@/lib/admin/hub-list-limits";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { canOperateFacilityVendorWorkflow } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type PayRow = Pick<
  Database["public"]["Tables"]["vendor_payments"]["Row"],
  "id" | "payment_date" | "amount_cents" | "payment_method"
>;
type EntityMini = { id: string; name: string };
type VendorMini = { id: string; name: string };
type FacMini = { id: string; name: string };

const VENDOR_PAYMENTS_LIST_LIMIT = 50;

export default function VendorPaymentsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { organizationId, appRole, loading: authLoading } = useHavenAuth();
  const [entityId, setEntityId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("ach");
  const [payDate, setPayDate] = useState(() => todayFacilityDateIso());
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: hubData,
    isPending,
    error,
  } = useQuery({
    queryKey: ["vendors", "payments", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const orgId = organizationId as string;
      const [{ data: payments, error: paymentsErr }, { data: entities }, { data: vendors }, { data: facilities }] =
        await Promise.all([
          supabase
            .from("vendor_payments")
            .select(VENDOR_PAYMENTS_LIST_SELECT)
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .order("payment_date", { ascending: false })
            .limit(VENDOR_PAYMENTS_LIST_LIMIT),
          supabase
            .from("entities")
            .select("id, name")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .order("name"),
          supabase
            .from("vendors")
            .select("id, name")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .order("name"),
          supabase
            .from("facilities")
            .select("id, name")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .order("name"),
        ]);
      if (paymentsErr) throw new Error(paymentsErr.message);
      return {
        rows: (payments ?? []) as PayRow[],
        entities: (entities ?? []) as EntityMini[],
        vendors: (vendors ?? []) as VendorMini[],
        facilities: (facilities ?? []) as FacMini[],
      };
    },
  });

  const rows = hubData?.rows ?? [];
  const entities = hubData?.entities ?? [];
  const vendors = hubData?.vendors ?? [];
  const facilities = hubData?.facilities ?? [];

  const loading = authLoading || isPending;
  const loadError =
    actionError ??
    (!authLoading && !organizationId
      ? "Organization missing on profile."
      : error
        ? error.message
        : null);

  const canPay =
    !!organizationId &&
    canOperateFacilityVendorWorkflow(appRole as Database["public"]["Enums"]["app_role"]);

  async function onPay(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !canPay || !entityId || !vendorId || !facilityId) return;
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setActionError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    setActionError(null);
    const { error: insertErr } = await supabase.from("vendor_payments").insert({
      organization_id: organizationId,
      entity_id: entityId,
      vendor_id: vendorId,
      facility_id: facilityId,
      payment_date: payDate,
      amount_cents: cents,
      payment_method: method,
    });
    setSaving(false);
    if (insertErr) {
      setActionError(insertErr.message);
      return;
    }
    setAmount("");
    await queryClient.invalidateQueries({ queryKey: ["vendors", "payments", organizationId] });
  }

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Vendor payments</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Record disbursements (GL posting is application-layer).</p>
      </div>

      {canPay && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record payment</CardTitle>
            <CardDescription>Links to entity, vendor, and facility for traceability.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onPay} className="max-w-lg space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ent">Entity</Label>
                <select
                  id="ent"
                  required
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={entityId}
                  onChange={(ev) => setEntityId(ev.target.value)}
                >
                  <option value="">Entity…</option>
                  {entities.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vend">Vendor</Label>
                <select
                  id="vend"
                  required
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={vendorId}
                  onChange={(ev) => setVendorId(ev.target.value)}
                >
                  <option value="">Vendor…</option>
                  {vendors.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facp">Facility</Label>
                <select
                  id="facp"
                  required
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={facilityId}
                  onChange={(ev) => setFacilityId(ev.target.value)}
                >
                  <option value="">Facility…</option>
                  {facilities.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amt">Amount (USD)</Label>
                  <Input id="amt" value={amount} onChange={(ev) => setAmount(ev.target.value)} inputMode="decimal" placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pd">Payment date (ET)</Label>
                  <Input
                    id="pd"
                    type="date"
                    value={payDate}
                    onChange={(ev) => setPayDate(ev.target.value)}
                    aria-label="Payment date (Eastern Time)"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="meth">Method</Label>
                <select
                  id="meth"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={method}
                  onChange={(ev) => setMethod(ev.target.value)}
                >
                  <option value="ach">ACH</option>
                  <option value="check">Check</option>
                  <option value="wire">Wire</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Record payment"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent payments</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} shown`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Date</th>
                <th className="pb-2 pr-4 font-medium">Amount</th>
                <th className="pb-2 font-medium">Method</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4 tabular-nums">{r.payment_date}</td>
                  <td className="py-2 pr-4">{formatUsdFromCents(r.amount_cents)}</td>
                  <td className="py-2">{r.payment_method}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-slate-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
