"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { VEHICLE_NEW_LOADING_PROFILE_COPY } from "@/lib/transportation/vehicle-new-display-copy";
import {
  isVehicleNewSubmitBlocked,
  resolveVehicleNewFetchErrorBannerMessage,
  resolveVehicleNewOrganizationGapMessage,
  resolveVehicleNewSubmitButtonLabel,
} from "@/lib/transportation/vehicle-new-page-state";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Status = Database["public"]["Enums"]["fleet_vehicle_status"];

const STATUS_OPTIONS: Status[] = ["active", "out_of_service", "retired"];

export default function AdminTransportationVehicleNewPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [name, setName] = useState("");
  const [vin, setVin] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [modelYear, setModelYear] = useState("");
  const [capacity, setCapacity] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [insurance, setInsurance] = useState("");
  const [registration, setRegistration] = useState("");
  const [notes, setNotes] = useState("");
  const [wheelchairAccessible, setWheelchairAccessible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const organizationGapMessage = resolveVehicleNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const submitErrorBannerMessage = resolveVehicleNewFetchErrorBannerMessage({
    authLoading,
    fetchError: submitError,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
    if (
      isVehicleNewSubmitBlocked({
        saving,
        authLoading,
        user,
        organizationId,
        facilityReady,
        name,
      })
    ) {
      return;
    }
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setSubmitError(null);
    try {
      const cap = capacity.trim() ? Number.parseInt(capacity, 10) : null;
      const year = modelYear.trim() ? Number.parseInt(modelYear, 10) : null;
      const { error: insErr } = await supabase.from("fleet_vehicles").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        name: name.trim(),
        vin: vin.trim() || null,
        license_plate: licensePlate.trim() || null,
        make: make.trim() || null,
        model: model.trim() || null,
        model_year: year != null && !Number.isNaN(year) ? year : null,
        passenger_capacity: cap != null && !Number.isNaN(cap) ? cap : null,
        status,
        insurance_expires_on: insurance.trim() || null,
        registration_expires_on: registration.trim() || null,
        notes: notes.trim() || null,
        wheelchair_accessible: wheelchairAccessible,
        created_by: user.id,
      });
      if (insErr) {
        setSubmitError(insErr.message);
        return;
      }
      router.push("/admin/transportation");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const submitBlocked = isVehicleNewSubmitBlocked({
    saving,
    authLoading,
    user,
    organizationId,
    facilityReady,
    name,
  });
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Add vehicle
        </h1>
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {VEHICLE_NEW_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {!facilityReady && !authLoading ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      ) : null}

      {submitErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {submitErrorBannerMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Fleet unit</CardTitle>
          <CardDescription>Identifiers and compliance dates for a facility-owned vehicle.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Van 1" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plate">License plate</Label>
                <Input id="plate" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vin">VIN</Label>
                <Input id="vin" value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="make">Make</Label>
                <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yr">Year</Label>
                <Input
                  id="yr"
                  inputMode="numeric"
                  value={modelYear}
                  onChange={(e) => setModelYear(e.target.value)}
                  placeholder="2022"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cap">Passenger capacity</Label>
                <Input id="cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st">Status</Label>
                <select id="st" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ins">Insurance expires (ET)</Label>
                <Input id="ins" type="date" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg">Registration expires (ET)</Label>
                <Input id="reg" type="date" value={registration} onChange={(e) => setRegistration(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wheelchairAccessible}
                onChange={(e) => setWheelchairAccessible(e.target.checked)}
                className="rounded border-input"
              />
              Wheelchair accessible (ADA / lift)
            </label>
            <Button type="submit" disabled={submitBlocked}>
              {resolveVehicleNewSubmitButtonLabel({
                saving,
                authLoading,
                user,
                organizationId,
                facilityReady,
                name,
              })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
