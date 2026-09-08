"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { medicationShiftRows, startMedicationShift } from "@/lib/med-tech/shift-commands";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";

type Assignment = { id: string; shift_start: string; shift_end: string; status: string };

export function ShiftStart({ onStarted }: { onStarted: () => Promise<void> | void }) {
  const { user } = useHavenAuth();
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    if (!user) { setLoading(false); setRows([]); return; }
    void (async () => {
      try {
        const result = await medicationShiftRows()
          .select("id,shift_start,shift_end,status").eq("user_id", user.id)
          .in("status", ["scheduled", "active"]).is("deleted_at", null)
          .gt("shift_end", new Date().toISOString())
          .order("shift_start").order("id").limit(20);
        if (result.error) throw new Error(result.error.message);
        if (current) setRows(result.data ?? []);
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message : "Unable to load medication assignments.");
      } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [user, reload]);

  async function start(id: string) {
    setBusy(id);
    setError("");
    try {
      await startMedicationShift(id);
      await onStarted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Starting the assignment was not confirmed. Retry the same assignment.");
    } finally { setBusy(null); }
  }

  return <section className="space-y-4" aria-label="Start medication assignment">
    <h2 className="text-lg font-semibold">Medication assignments</h2>
    <p className="text-sm">Start an assignment provided by your nurse or facility administrator. This opens the prescribed pass queue; it does not record payroll time.</p>
    {loading && <p role="status">Loading assignments…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && rows.length === 0 && <p>No current or upcoming medication assignment. Ask your nurse or facility administrator to assign your residents and shift window.</p>}
    {!loading && rows.map(row => <div key={row.id} className="space-y-2 rounded-lg border p-3">
      <p>{formatFacilityTimestampEt(row.shift_start)} – {formatFacilityTimestampEt(row.shift_end)}</p>
      <Button disabled={!!busy || Date.parse(row.shift_start) > Date.now()} onClick={() => void start(row.id)}>
        {busy === row.id ? "Starting…" : "Start medication assignment"}
      </Button>
    </div>)}
    {rows.length === 20 && <p className="text-sm">Showing your next 20 assignments.</p>}
    <Button variant="outline" disabled={!!busy} onClick={() => setReload(value => value + 1)}>Refresh assignments</Button>
  </section>;
}
