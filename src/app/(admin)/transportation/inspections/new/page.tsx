"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Result = Database["public"]["Enums"]["vehicle_inspection_result"];

const RESULT_OPTIONS: Result[] = ["pass", "fail", "conditional"];

export default function AdminTransportationInspectionNewPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [vehicles, setVehicles] = useState<{ id: string; name: string }[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [inspectedAt, setInspectedAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [inspector, setInspector] = useState("");
  const [odometer, setOdometer] = useState("");
  const [result, setResult] = useState<Result>("pass");
  const [defects, setDefects] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setVehicles([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("fleet_vehicles")
        .select("id, name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (qErr) throw qErr;
      setVehicles(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load vehicles.");
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !vehicleId) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const odo = odometer.trim() ? Number.parseInt(odometer, 10) : null;
      const inspectedIso = inspectedAt ? new Date(inspectedAt).toISOString() : new Date().toISOString();
      const { error: insErr } = await supabase.from("vehicle_inspection_logs").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: selectedFacilityId,
        fleet_vehicle_id: vehicleId,
        inspected_at: inspectedIso,
        inspector_label: inspector.trim() || null,
        odometer_miles: odo != null && !Number.isNaN(odo) ? odo : null,
        result,
        defects_notes: defects.trim() || null,
        created_by: user.id,
      });
      if (insErr) throw insErr;
      router.push("/admin/transportation");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Log inspection
        </h1>
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {!facilityReady && (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Inspection</CardTitle>
          <CardDescription>Attach a result to a fleet vehicle for audit history.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="veh">Vehicle</Label>
              {loading ? (
                <p className="text-sm text-slate-500">Loading vehicles…</p>
              ) : (
                <select
                  id="veh"
                  required
                  className={selectClass}
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  disabled={!facilityReady || vehicles.length === 0}
                >
                  <option value="">Select…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="when">Inspected at</Label>
              <Input id="when" type="datetime-local" value={inspectedAt} onChange={(e) => setInspectedAt(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="res">Result</Label>
                <select id="res" className={selectClass} value={result} onChange={(e) => setResult(e.target.value as Result)}>
                  {RESULT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="odo">Odometer (miles)</Label>
                <Input id="odo" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="insp">Inspector label</Label>
              <Input id="insp" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Name or badge" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="def">Defects / notes</Label>
              <Input id="def" value={defects} onChange={(e) => setDefects(e.target.value)} />
            </div>
            <Button type="submit" disabled={saving || !facilityReady || !vehicleId}>
              {saving ? "Saving…" : "Save inspection"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
