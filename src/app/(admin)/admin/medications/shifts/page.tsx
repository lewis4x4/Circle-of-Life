"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { createMedicationShift, listMedicationShiftStaff, medicationShiftRows, MedicationShiftCommandError } from "@/lib/med-tech/shift-commands";
import { FACILITY_OPERATOR_TZ, facilityDatetimeLocalToUtcIso, formatFacilityTimestampEt, utcIsoToFacilityDatetimeLocal } from "@/lib/facility-wall-clock";

type Staff = { id: string; full_name: string; app_role: string };
type Resident = { id: string; first_name: string; last_name: string };
type Shift = { id: string; user_id: string; shift_start: string; shift_end: string; status: string };
type Command = Parameters<typeof createMedicationShift>[0];
const MANAGERS = ["owner", "org_admin", "facility_admin", "nurse"];
const message = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Request failed. Please retry.";

export default function MedicationShiftsPage() {
  const auth = useHavenAuth();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadedFacility, setLoadedFacility] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [userId, setUserId] = useState("");
  const [residentIds, setResidentIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pending, setPending] = useState<Command | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const ambiguousRequest = useRef<string | null>(null);
  const draftFacility = useRef(selectedFacilityId);
  const [saveError, setSaveError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const allowed = MANAGERS.includes(auth.appRole);

  useEffect(() => {
    if (!pending && draftFacility.current !== selectedFacilityId) {
      draftFacility.current = selectedFacilityId;
      setUserId(""); setResidentIds([]); setStartsAt(""); setEndsAt("");
    }
  }, [selectedFacilityId, pending]);

  useEffect(() => {
    let active = true;
    setLoadedFacility(null);
    setLoadError("");
    if (!selectedFacilityId || !allowed || auth.loading) return;
    void (async () => {
      try {
        const [people, residentResult, shiftResult] = await Promise.all([
          listMedicationShiftStaff(selectedFacilityId),
          supabase.from("residents").select("id,first_name,last_name").eq("facility_id", selectedFacilityId).eq("status", "active").is("deleted_at", null).order("last_name"),
          medicationShiftRows().select("id,user_id,shift_start,shift_end,status").eq("facility_id", selectedFacilityId).is("deleted_at", null).order("shift_start", { ascending: false }).limit(100),
        ]);
        if (residentResult.error) throw residentResult.error;
        if (shiftResult.error) throw shiftResult.error;
        if (!active) return;
        setStaff(people);
        setResidents((residentResult.data ?? []) as Resident[]);
        setShifts((shiftResult.data ?? []) as Shift[]);
        setLoadedFacility(selectedFacilityId);
      } catch (error) { if (active) setLoadError(message(error)); }
    })();
    return () => { active = false; };
  }, [selectedFacilityId, allowed, auth.loading, auth.organizationId, supabase, reload]);

  async function save() {
    if (savingRef.current) return;
    setSaveError("");
    setConfirmation("");
    let command = pending;
    try {
      if (!command) {
        if (!selectedFacilityId || loadedFacility !== selectedFacilityId || !staff.some(person => person.id === userId) || !residentIds.length || residentIds.some(id => !residents.some(resident => resident.id === id))) throw new Error("Choose an eligible staff member and at least one resident at this facility.");
        const start = facilityDatetimeLocalToUtcIso(startsAt);
        const end = facilityDatetimeLocalToUtcIso(endsAt);
        if (utcIsoToFacilityDatetimeLocal(start) !== startsAt || utcIsoToFacilityDatetimeLocal(end) !== endsAt) throw new Error("Choose valid facility times; a daylight-saving time gap cannot be used.");
        const duration = Date.parse(end) - Date.parse(start);
        if (duration <= 0 || duration > 24 * 60 * 60 * 1000 || Date.parse(end) <= Date.now()) throw new Error("End must be in the future, after start, and within 24 hours of start.");
        command = { id: crypto.randomUUID(), facilityId: selectedFacilityId, userId, startsAt: start, endsAt: end, residentIds: [...residentIds] };
        setPending(command);
      }
      savingRef.current = true;
      setSaving(true);
      const id = await createMedicationShift(command);
      setConfirmation(`Medication shift saved (${id}). The assignee can start it during its assigned window.`);
      ambiguousRequest.current = null;
      setPending(null);
      setUserId(""); setResidentIds([]); setStartsAt(""); setEndsAt("");
      setReload(value => value + 1);
    } catch (error) {
      if (command && savingRef.current) {
        if (error instanceof MedicationShiftCommandError && error.definitive) {
          if (ambiguousRequest.current !== command.id) setPending(null);
        } else {
          ambiguousRequest.current = command.id;
        }
      }
      setSaveError(message(error));
    }
    finally { savingRef.current = false; setSaving(false); }
  }

  if (auth.loading) return <p role="status">Checking access…</p>;
  if (!allowed) return <p role="alert">Medication shift assignments require an owner, organization administrator, facility administrator, or nurse.</p>;
  const ready = loadedFacility === selectedFacilityId && !!selectedFacilityId;
  const facilityName = (id: string) => availableFacilities.find(f => f.id === id)?.name ?? id;
  return <div className="flex flex-col gap-6">
    <Link href="/admin/medications">Back to medication management</Link>
    <div><h1 className="text-xl font-semibold">Medication shift assignments</h1><p className="text-sm text-muted-foreground">Assign clinical medication work and residents. This does not publish staffing schedules or record payroll clock-in.</p></div>
    {!selectedFacilityId && <p>Select a facility using the facility selector.</p>}
    {selectedFacilityId && <p>Facility: {facilityName(selectedFacilityId)}</p>}
    {loadError ? <div role="alert">Unable to load assignments: {loadError} <Button onClick={() => setReload(value => value + 1)}>Retry loading</Button></div> : selectedFacilityId && !ready && <p role="status">Loading assignments…</p>}
    {confirmation && <p role="status">{confirmation}</p>}
    {saveError && <p role="alert">{saveError}</p>}
    {pending && <p role="status">Save awaiting confirmation for {facilityName(pending.facilityId)}. The original assignment is retained; retry uses the same request.</p>}
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4 rounded-lg border bg-card p-4">
      <fieldset disabled={!!pending || !ready || !!loadError} className="space-y-4">
        <legend className="font-semibold">New clinical assignment</legend>
        <label className="block">Staff member<select aria-label="Staff member" className="block w-full rounded-md border bg-background p-2" value={userId} onChange={event => setUserId(event.target.value)} required><option value="">Choose staff</option>{staff.map(person => <option key={person.id} value={person.id}>{person.full_name} ({person.app_role === "nurse" ? "Nurse" : "Medication technician"})</option>)}</select></label>
        {ready && !staff.length && <p>No eligible medication staff at this facility.</p>}
        <p className="text-sm">Times use {FACILITY_OPERATOR_TZ}. A single assignment may last up to 24 hours.</p>
        <label className="block" htmlFor="shift-start">Start time</label><Input id="shift-start" type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} required />
        <label className="block" htmlFor="shift-end">End time</label><Input id="shift-end" type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} required />
        <fieldset><legend>Assigned residents</legend>{residents.map(resident => <label key={resident.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={residentIds.includes(resident.id)} onChange={event => setResidentIds(ids => event.target.checked ? [...ids, resident.id] : ids.filter(id => id !== resident.id))} />{resident.first_name} {resident.last_name}</label>)}{ready && !residents.length && <p>No active residents at this facility.</p>}</fieldset>
      </fieldset>
      <Button type="submit" disabled={saving || (!pending && (!ready || !!loadError))}>{saving ? "Saving…" : pending ? "Retry original assignment" : "Save assignment"}</Button>
    </form>
    {ready && !loadError && <section aria-label="Saved assignments"><h2 className="font-semibold">Recent assignments</h2>{!shifts.length ? <p>No medication shifts assigned.</p> : <ul className="space-y-2">{shifts.map(shift => <li key={shift.id} className="rounded-md border p-3">{staff.find(person => person.id === shift.user_id)?.full_name ?? "Staff member no longer available"} — {formatFacilityTimestampEt(shift.shift_start)} to {formatFacilityTimestampEt(shift.shift_end)} ({shift.status})</li>)}</ul>}</section>}
  </div>;
}
