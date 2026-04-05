"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { canManageVendorMaster } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type VendorRow = Database["public"]["Tables"]["vendors"]["Row"];
type FacilityMini = { id: string; name: string };

export default function VendorDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [facilities, setFacilities] = useState<FacilityMini[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  const [counts, setCounts] = useState({ contracts: 0, pos: 0, invoices: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [addFacilityId, setAddFacilityId] = useState<string>("");
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setVendor(null);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data: v, error: ve } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", id)
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ve || !v) {
      setLoadError(ve?.message ?? "Vendor not found.");
      setVendor(null);
      setLoading(false);
      return;
    }
    setVendor(v as VendorRow);

    const { data: fac } = await supabase
      .from("facilities")
      .select("id, name")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("name");
    setFacilities((fac ?? []) as FacilityMini[]);

    const { data: vf } = await supabase
      .from("vendor_facilities")
      .select("facility_id")
      .eq("vendor_id", id)
      .is("deleted_at", null);
    setLinked((vf ?? []).map((r) => r.facility_id as string));

    const [ct, po, inv] = await Promise.all([
      supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", id)
        .is("deleted_at", null),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", id)
        .is("deleted_at", null),
      supabase
        .from("vendor_invoices")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", id)
        .is("deleted_at", null),
    ]);
    setCounts({
      contracts: ct.count ?? 0,
      pos: po.count ?? 0,
      invoices: inv.count ?? 0,
    });
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const canWrite = ctx?.ok && canManageVendorMaster(ctx.ctx.appRole);
  const availableToLink = facilities.filter((f) => !linked.includes(f.id));

  async function linkFacility() {
    if (!ctx?.ok || !vendor || !addFacilityId) return;
    setLinking(true);
    setLoadError(null);
    const { error } = await supabase.from("vendor_facilities").insert({
      organization_id: ctx.ctx.organizationId,
      vendor_id: vendor.id,
      facility_id: addFacilityId,
    });
    setLinking(false);
    if (error) setLoadError(error.message);
    else {
      setAddFacilityId("");
      await load();
    }
  }

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      {loading && !vendor ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : vendor ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{vendor.name}</h1>
            <p className="text-sm capitalize text-slate-600 dark:text-slate-400">
              {vendor.category} · {vendor.status}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contracts</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{counts.contracts}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Purchase orders</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{counts.pos}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invoices</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{counts.invoices}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Facilities served</CardTitle>
              <CardDescription>Link this vendor to sites where they deliver goods or services.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="list-inside list-disc text-sm text-slate-700 dark:text-slate-300">
                {linked.length === 0 ? (
                  <li className="list-none text-slate-500">No facilities linked.</li>
                ) : (
                  linked.map((fid) => (
                    <li key={fid}>{facilities.find((f) => f.id === fid)?.name ?? fid}</li>
                  ))
                )}
              </ul>
              {canWrite && availableToLink.length > 0 && (
                <div className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="add-facility">Add facility</Label>
                    <select
                      id="add-facility"
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                      value={addFacilityId}
                      onChange={(ev) => setAddFacilityId(ev.target.value)}
                    >
                      <option value="">Choose facility…</option>
                      {availableToLink.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="button" disabled={!addFacilityId || linking} onClick={() => void linkFacility()}>
                    {linking ? "Linking…" : "Link"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2 text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/contracts">
              View contracts
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/purchase-orders">
              View POs
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
