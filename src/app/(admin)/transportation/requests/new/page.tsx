"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { normalizeTimeForDb, residentTransportRequestCreateSchema } from "@/lib/transport/transport-request-schemas";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type TransportType = Database["public"]["Enums"]["transport_type"];

const TRANSPORT_TYPES: { value: TransportType; label: string }[] = [
  { value: "facility_vehicle", label: "Facility vehicle" },
  { value: "staff_personal_vehicle", label: "Staff personal vehicle" },
  { value: "third_party", label: "Third-party" },
];

type ResidentOption = { id: string; first_name: string; last_name: string };

export default function NewResidentTransportRequestPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [residentId, setResidentId] = useState("");
  const [transportType, setTransportType] = useState<TransportType>("facility_vehicle");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wheelchairRequired, setWheelchairRequired] = useState(false);
  const [escortRequired, setEscortRequired] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLoadingResidents(false);
      return;
    }
    setLoadingResidents(true);
    try {
      const { data, error: qErr } = await supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(500);
      if (qErr) throw qErr;
      setResidents((data ?? []) as ResidentOption[]);
    } catch {
      setResidents([]);
    } finally {
      setLoadingResidents(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      const parsed = residentTransportRequestCreateSchema.safeParse({
        resident_id: residentId,
        transport_type: transportType,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime.trim() || null,
        destination_name: destinationName,
        destination_address: destinationAddress.trim() || null,
        purpose,
        wheelchair_required: wheelchairRequired,
        escort_required: escortRequired,
        notes: notes.trim() || null,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((x) => x.message).join(" ") || "Invalid form.");
      }

      const t = normalizeTimeForDb(parsed.data.appointment_time ?? undefined);
      const { data: inserted, error: insErr } = await supabase
        .from("resident_transport_requests")
        .insert({
          organization_id: ctx.ctx.organizationId,
          facility_id: selectedFacilityId,
          resident_id: parsed.data.resident_id,
          requested_by: user.id,
          transport_type: parsed.data.transport_type,
          appointment_date: parsed.data.appointment_date,
          appointment_time: t,
          destination_name: parsed.data.destination_name,
          destination_address: parsed.data.destination_address,
          purpose: parsed.data.purpose,
          wheelchair_required: parsed.data.wheelchair_required,
          escort_required: parsed.data.escort_required,
          notes: parsed.data.notes,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      if (inserted?.id) router.push(`/admin/transportation/requests/${inserted.id}`);
      else router.push("/admin/transportation");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const selectClass = cn(
    "h-9 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">SYS: Module 15</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            New transport request
          </h1>
        </div>
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {!facilityReady && (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card className="border-slate-200/80 dark:border-slate-800">
        <CardHeader>
          <CardTitle>Resident trip</CardTitle>
          <CardDescription>Appointment transport — requested → scheduled → completed (spec 15).</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="space-y-2">
              <Label htmlFor="resident">Resident</Label>
              <select
                id="resident"
                required
                className={selectClass}
                value={residentId}
                onChange={(e) => setResidentId(e.target.value)}
                disabled={!facilityReady || loadingResidents}
              >
                <option value="">Select resident…</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.last_name}, {r.first_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transportType">Transport type</Label>
              <select
                id="transportType"
                className={selectClass}
                value={transportType}
                onChange={(e) => setTransportType(e.target.value as TransportType)}
              >
                {TRANSPORT_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="apptDate">Appointment date</Label>
                <Input
                  id="apptDate"
                  type="date"
                  required
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apptTime">Appointment time (optional)</Label>
                <Input
                  id="apptTime"
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="destName">Destination name</Label>
              <Input
                id="destName"
                required
                value={destinationName}
                onChange={(e) => setDestinationName(e.target.value)}
                placeholder="Clinic name or venue"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destAddr">Destination address (optional)</Label>
              <Input
                id="destAddr"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Street, city"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purpose">Purpose</Label>
              <Input
                id="purpose"
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Physician appointment, lab, outing…"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={wheelchairRequired}
                  onChange={(e) => setWheelchairRequired(e.target.checked)}
                  className="rounded border-input"
                />
                Wheelchair required
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={escortRequired}
                  onChange={(e) => setEscortRequired(e.target.checked)}
                  className="rounded border-input"
                />
                Escort required
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={!facilityReady || saving}>
                {saving ? "Saving…" : "Create request"}
              </Button>
              <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "ghost" }))}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
