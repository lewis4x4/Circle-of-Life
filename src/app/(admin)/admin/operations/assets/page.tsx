"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Cog, Hammer, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";

type AssetRow = {
  id: string;
  asset_type: string;
  name: string;
  status: string;
  asset_tag: string | null;
  install_location: string | null;
  next_service_due_at: string | null;
  lifecycle_replace_by: string | null;
  service_interval_days: number | null;
  last_service_vendor_id: string | null;
  last_service_vendor_name: string | null;
  linked_template_count: number;
};

type VendorOption = {
  id: string;
  name: string;
};

export default function OperationsAssetsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateSavingId, setTemplateSavingId] = useState<string | null>(null);
  const [newAsset, setNewAsset] = useState({
    name: "",
    asset_type: "generator",
    asset_tag: "",
    install_location: "",
    service_interval_days: "30",
    next_service_due_at: "",
    last_service_vendor_id: "",
  });

  const load = useCallback(async () => {
    if (!selectedFacilityId) {
      setAssets([]);
      setVendors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [assetResponse, vendorResponse] = await Promise.all([
        fetch(`/api/admin/operations/assets?facility_id=${encodeURIComponent(selectedFacilityId)}`),
        fetch(`/api/admin/operations/vendors?facility_id=${encodeURIComponent(selectedFacilityId)}`),
      ]);
      const assetJson = await assetResponse.json();
      const vendorJson = await vendorResponse.json();
      if (!assetResponse.ok) throw new Error(assetJson.error || "Failed to load assets");
      if (!vendorResponse.ok) throw new Error(vendorJson.error || "Failed to load vendors");
      setAssets(assetJson.assets || []);
      setVendors((vendorJson.vendors || []).map((vendor: { id: string; name: string }) => ({ id: vendor.id, name: vendor.name })));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load asset register.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const today = new Date();
    const overdue = assets.filter((asset) => asset.next_service_due_at && new Date(asset.next_service_due_at) < today).length;
    const dueSoon = assets.filter((asset) => {
      if (!asset.next_service_due_at) return false;
      const due = new Date(asset.next_service_due_at);
      const diffDays = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 30;
    }).length;
    return {
      total: assets.length,
      overdue,
      dueSoon,
      templated: assets.filter((asset) => asset.linked_template_count > 0).length,
    };
  }, [assets]);

  async function createAsset() {
    if (!selectedFacilityId || !newAsset.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/operations/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: selectedFacilityId,
          name: newAsset.name.trim(),
          asset_type: newAsset.asset_type,
          asset_tag: newAsset.asset_tag.trim() || null,
          install_location: newAsset.install_location.trim() || null,
          service_interval_days: Number.parseInt(newAsset.service_interval_days, 10) || null,
          next_service_due_at: newAsset.next_service_due_at || null,
          last_service_vendor_id: newAsset.last_service_vendor_id || null,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to create asset");
      setNewAsset({
        name: "",
        asset_type: "generator",
        asset_tag: "",
        install_location: "",
        service_interval_days: "30",
        next_service_due_at: "",
        last_service_vendor_id: "",
      });
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to create asset.");
    } finally {
      setSaving(false);
    }
  }

  async function createMaintenanceTemplate(asset: AssetRow) {
    if (!selectedFacilityId) return;
    setTemplateSavingId(asset.id);
    setError(null);
    try {
      const cadence = asset.service_interval_days && asset.service_interval_days <= 31 ? "monthly" : "quarterly";
      const response = await fetch("/api/admin/operations/maintenance-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: selectedFacilityId,
          name: `${asset.name} service review`,
          description: `Review ${asset.name} service requirements and confirm vendor follow-up.`,
          category: "maintenance",
          cadence_type: cadence,
          day_of_month: 1,
          assignee_role: "maintenance",
          priority: "high",
          estimated_minutes: 30,
          asset_ref: asset.id,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to create maintenance template");
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to create maintenance template.");
    } finally {
      setTemplateSavingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Operations Cadence Engine</p>
        <h1 className="text-3xl font-semibold tracking-tight">Asset Register</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Track physical plant assets, upcoming service windows, and the maintenance templates tied to them.
        </p>
      </div>

      <OperationsViewNav />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Tracked assets" value={String(summary.total)} icon={Cog} />
        <SummaryCard label="Overdue service" value={String(summary.overdue)} icon={AlertTriangle} tone="red" />
        <SummaryCard label="Due in 30 days" value={String(summary.dueSoon)} icon={CalendarClock} tone="amber" />
        <SummaryCard label="Templated assets" value={String(summary.templated)} icon={Hammer} tone="emerald" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add asset</CardTitle>
          <CardDescription>Create a facility asset and optionally attach a service vendor.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Asset name">
            <Input value={newAsset.name} onChange={(event) => setNewAsset((current) => ({ ...current, name: event.target.value }))} placeholder="Backup generator" />
          </Field>
          <Field label="Type">
            <select
              value={newAsset.asset_type}
              onChange={(event) => setNewAsset((current) => ({ ...current, asset_type: event.target.value }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {["generator", "aed", "fire_extinguisher", "sprinkler_system", "hood_suppression", "ac_unit", "elevator", "kitchen_equipment", "laundry_equipment", "furniture", "vehicle", "other"].map((option) => (
                <option key={option} value={option}>{option.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Field>
          <Field label="Asset tag">
            <Input value={newAsset.asset_tag} onChange={(event) => setNewAsset((current) => ({ ...current, asset_tag: event.target.value }))} placeholder="GEN-01" />
          </Field>
          <Field label="Install location">
            <Input value={newAsset.install_location} onChange={(event) => setNewAsset((current) => ({ ...current, install_location: event.target.value }))} placeholder="Mechanical room" />
          </Field>
          <Field label="Service interval days">
            <Input value={newAsset.service_interval_days} onChange={(event) => setNewAsset((current) => ({ ...current, service_interval_days: event.target.value }))} inputMode="numeric" />
          </Field>
          <Field label="Next service due">
            <Input type="date" value={newAsset.next_service_due_at} onChange={(event) => setNewAsset((current) => ({ ...current, next_service_due_at: event.target.value }))} />
          </Field>
          <Field label="Service vendor">
            <select
              value={newAsset.last_service_vendor_id}
              onChange={(event) => setNewAsset((current) => ({ ...current, last_service_vendor_id: event.target.value }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button disabled={saving || !selectedFacilityId || !newAsset.name.trim()} onClick={() => void createAsset()}>
              <Plus className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Create asset"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
          <CardDescription>{loading ? "Loading asset register..." : `${assets.length} assets in the selected facility`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{asset.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
                      {asset.asset_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {asset.install_location || "Location not set"}
                    {asset.asset_tag ? ` · ${asset.asset_tag}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Service vendor: {asset.last_service_vendor_name || "Unassigned"}
                    {asset.next_service_due_at ? ` · due ${asset.next_service_due_at}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/vendors${asset.last_service_vendor_id ? `/${asset.last_service_vendor_id}` : ""}`} className="text-sm text-primary underline-offset-4 hover:underline">
                    Vendor record
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={templateSavingId === asset.id}
                    onClick={() => void createMaintenanceTemplate(asset)}
                  >
                    {templateSavingId === asset.id ? "Creating..." : asset.linked_template_count > 0 ? `Templates ${asset.linked_template_count}` : "Add template"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!loading && assets.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No assets recorded for this facility.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string;
  icon: typeof Cog;
  tone?: "slate" | "red" | "amber" | "emerald";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={cn("rounded-xl border p-4", toneClass)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}
