"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
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
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}

      {loading && !vendor ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : vendor ? (
        <>
          <RecordDetailHeader
            title={vendor.name}
            subtitle={`${vendor.category} · ${vendor.status}`}
            backLink={{ label: "Vendors", href: "/admin/vendors" }}
          />

          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                { label: "Contracts", value: counts.contracts },
                { label: "Purchase orders", value: counts.pos },
                { label: "Invoices", value: counts.invoices },
              ] as const
            ).map(({ label, value }) => (
              <div
                key={label}
                className="rounded-[8px] border border-border bg-card p-[14px] shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:-translate-y-0.5"
              >
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
              </div>
            ))}
          </div>

          <RecordDetailSection
            title="Facilities served"
            description="Link this vendor to sites where they deliver goods or services."
          >
            <div className="space-y-3">
              <ul className="list-inside list-disc text-sm text-foreground">
                {linked.length === 0 ? (
                  <li className="list-none text-muted-foreground">No facilities linked.</li>
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
                      className="flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
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
            </div>
          </RecordDetailSection>

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
