"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Bus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type FleetRow = Database["public"]["Tables"]["fleet_vehicles"]["Row"];
type InspectionRow = Database["public"]["Tables"]["vehicle_inspection_logs"]["Row"] & {
  fleet_vehicles: { name: string } | null;
};
type DriverRow = Database["public"]["Tables"]["driver_credentials"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

function formatEnum(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminTransportationHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFleet([]);
      setInspections([]);
      setDrivers([]);
      setLoading(false);
      return;
    }
    try {
      const [fRes, iRes, dRes] = await Promise.all([
        supabase
          .from("fleet_vehicles")
          .select("*")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(40),
        supabase
          .from("vehicle_inspection_logs")
          .select("*, fleet_vehicles(name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("inspected_at", { ascending: false })
          .limit(25),
        supabase
          .from("driver_credentials")
          .select("*, staff(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(40),
      ]);
      if (fRes.error) throw fRes.error;
      if (iRes.error) throw iRes.error;
      if (dRes.error) throw dRes.error;
      setFleet(fRes.data ?? []);
      setInspections((iRes.data ?? []) as InspectionRow[]);
      setDrivers((dRes.data ?? []) as DriverRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transportation data.");
      setFleet([]);
      setInspections([]);
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Transportation
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Fleet units, periodic inspections, and driver license snapshots for the selected facility.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/transportation/vehicles/new"
            className={cn(buttonVariants({ variant: "default" }), "inline-flex items-center gap-2")}
          >
            <Bus className="h-4 w-4" aria-hidden />
            Add vehicle
          </Link>
          <Link href="/admin/transportation/inspections/new" className={cn(buttonVariants({ variant: "secondary" }))}>
            Log inspection
          </Link>
          <Link href="/admin/transportation/drivers/new" className={cn(buttonVariants({ variant: "outline" }))}>
            Add driver credential
          </Link>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load fleet and driver records.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Fleet</CardTitle>
          <CardDescription>Active vans and shuttles registered for this site.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : fleet.length === 0 ? (
            <p className="text-sm text-slate-500">No vehicles yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Insurance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleet.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="capitalize">{formatEnum(row.status)}</TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">{row.license_plate ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.passenger_capacity ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.insurance_expires_on ? format(new Date(row.insurance_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent inspections</CardTitle>
          <CardDescription>Latest logged walk-arounds and safety checks.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : inspections.length === 0 ? (
            <p className="text-sm text-slate-500">No inspections logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Odometer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.fleet_vehicles?.name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(row.inspected_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="capitalize">{formatEnum(row.result)}</TableCell>
                    <TableCell className="text-xs">{row.odometer_miles ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Driver credentials</CardTitle>
          <CardDescription>License class and expiration tracking (one active record per staff member per facility).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : drivers.length === 0 ? (
            <p className="text-sm text-slate-500">No driver credentials yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>License expires</TableHead>
                  <TableHead>Med card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.staff ? `${row.staff.first_name} ${row.staff.last_name}`.trim() : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{formatEnum(row.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.license_expires_on ? format(new Date(row.license_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.medical_card_expires_on ? format(new Date(row.medical_card_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
