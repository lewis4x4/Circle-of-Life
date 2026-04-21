"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ClipboardCheck, Plus, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";

type VendorRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  notes: string | null;
  accepts_bookings: boolean | null;
  booking_confirmation_days_required: number | null;
  is_primary: boolean;
  linked_template_count: number;
};

export default function OperationsVendorBookingsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingVendorId, setSavingVendorId] = useState<string | null>(null);
  const [templateSavingId, setTemplateSavingId] = useState<string | null>(null);
  const [leadTimes, setLeadTimes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!selectedFacilityId) {
      setVendors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/operations/vendors?facility_id=${encodeURIComponent(selectedFacilityId)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to load facility vendors");
      setVendors(json.vendors || []);
      setLeadTimes(
        Object.fromEntries((json.vendors || []).map((vendor: VendorRow) => [
          vendor.id,
          String(vendor.booking_confirmation_days_required ?? 0),
        ])),
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load vendor bookings.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => ({
    total: vendors.length,
    bookingEnabled: vendors.filter((vendor) => vendor.accepts_bookings).length,
    templated: vendors.filter((vendor) => vendor.linked_template_count > 0).length,
  }), [vendors]);

  async function saveBookingConfig(vendor: VendorRow) {
    setSavingVendorId(vendor.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/operations/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepts_bookings: !vendor.accepts_bookings,
          booking_confirmation_days_required: Number.parseInt(leadTimes[vendor.id] || "0", 10) || 0,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to save vendor booking settings");
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to save vendor booking settings.");
    } finally {
      setSavingVendorId(null);
    }
  }

  async function createBookingTemplate(vendor: VendorRow) {
    if (!selectedFacilityId) return;
    setTemplateSavingId(vendor.id);
    setError(null);
    try {
      const leadDays = Number.parseInt(leadTimes[vendor.id] || "0", 10) || 0;
      const response = await fetch("/api/admin/operations/maintenance-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: selectedFacilityId,
          name: `${vendor.name} booking confirmation`,
          description: `Confirm ${vendor.name} booking ${leadDays} day(s) ahead of service.`,
          category: "vendor_management",
          cadence_type: "monthly",
          day_of_month: 1,
          assignee_role: "facility_administrator",
          priority: "normal",
          estimated_minutes: 15,
          vendor_booking_ref: vendor.id,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to create vendor booking template");
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to create vendor booking template.");
    } finally {
      setTemplateSavingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Operations Cadence Engine</p>
        <h1 className="text-3xl font-semibold tracking-tight">Vendor Bookings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Configure which facility vendors are booking-capable and turn them into recurring vendor-management tasks.
        </p>
      </div>

      <OperationsViewNav />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Facility vendors" value={String(summary.total)} icon={Wrench} />
        <SummaryCard label="Booking enabled" value={String(summary.bookingEnabled)} icon={ClipboardCheck} tone="emerald" />
        <SummaryCard label="Booking templates" value={String(summary.templated)} icon={CalendarDays} tone="amber" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Facility vendors</CardTitle>
          <CardDescription>{loading ? "Loading vendors..." : `${vendors.length} vendor links for the selected facility`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{vendor.name}</h3>
                    {vendor.is_primary && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs uppercase tracking-wide text-emerald-700">
                        primary
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {vendor.category} · {vendor.status}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {vendor.primary_contact_name || "No primary contact"}
                    {vendor.primary_contact_phone ? ` · ${vendor.primary_contact_phone}` : ""}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[180px_auto_auto]">
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Lead time (days)</span>
                    <Input
                      value={leadTimes[vendor.id] || "0"}
                      onChange={(event) => setLeadTimes((current) => ({ ...current, [vendor.id]: event.target.value }))}
                      inputMode="numeric"
                    />
                  </label>
                  <div className="flex items-end">
                    <Button
                      variant={vendor.accepts_bookings ? "default" : "outline"}
                      size="sm"
                      disabled={savingVendorId === vendor.id}
                      onClick={() => void saveBookingConfig(vendor)}
                    >
                      {savingVendorId === vendor.id ? "Saving..." : vendor.accepts_bookings ? "Disable booking" : "Enable booking"}
                    </Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={templateSavingId === vendor.id || !vendor.accepts_bookings}
                      onClick={() => void createBookingTemplate(vendor)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {templateSavingId === vendor.id ? "Creating..." : vendor.linked_template_count > 0 ? `Templates ${vendor.linked_template_count}` : "Add template"}
                    </Button>
                    <Link href={`/admin/vendors/${vendor.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
                      Vendor
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!loading && vendors.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No vendors are linked to this facility yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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
  icon: typeof Wrench;
  tone?: "slate" | "amber" | "emerald";
}) {
  const toneClass =
    tone === "amber"
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
