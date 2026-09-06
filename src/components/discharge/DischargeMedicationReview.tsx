"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { Database } from "@/types/database";
type Decision = {
    id: string;
    name: string;
    instructions: string;
    decision: string;
    plan: string;
};
type Snapshot = {
    medications: Decision[];
    captured_at: string;
    no_medications_confirmed?: boolean;
};
export function DischargeMedicationReview({ residentId, initial, onSave, busy }: {
    residentId: string;
    initial: unknown;
    onSave: (snapshot: Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"]["med_snapshot_json"]) => void;
    busy: boolean;
}) {
    const client = useMemo(() => createClient(), []);
    const saved = initial && typeof initial === "object" && "medications" in initial ? initial as Snapshot : null;
    const [snapshot, setSnapshot] = useState<Snapshot | null>(saved);
    const [error, setError] = useState<string | null>(null);
    async function capture() {
        setError(null);
        const result = await client.from("resident_medications").select("id, medication_name, strength, instructions, frequency, route").eq("resident_id", residentId).eq("status", "active").is("deleted_at", null);
        if (result.error) {
            setError(result.error.message);
            return;
        }
        setSnapshot({ captured_at: new Date().toISOString(), medications: (result.data ?? []).map((med) => ({ id: med.id, name: `${med.medication_name} ${med.strength ?? ""}`, instructions: [med.frequency, med.route, med.instructions].filter(Boolean).join(" · "), decision: "", plan: "" })) });
    }
    const ready = snapshot && (snapshot.medications.length ? snapshot.medications.every((med) => med.decision && med.plan.trim()) : snapshot.no_medications_confirmed);
    return <div className="space-y-3"><fieldset disabled={busy} className="contents"><p>Review each current medication against the discharge orders. Record the intended transition and instructions; this does not change the active medication order.</p><Button variant="outline" disabled={busy} onClick={() => void capture()}>Load current medications for review</Button>{error && <p role="alert">{error}</p>}{snapshot && <><p className="text-sm">Medication list captured {new Date(snapshot.captured_at).toLocaleString()}</p>{snapshot.medications.map((med) => <div key={med.id} className="space-y-2 rounded border p-3"><strong>{med.name}</strong><p>{med.instructions}</p><label>Discharge decision<select value={med.decision} onChange={(e) => setSnapshot({ ...snapshot, medications: snapshot.medications.map((item) => item.id === med.id ? { ...item, decision: e.target.value } : item) })} className="block w-full rounded border p-2"><option value="">Choose decision</option><option value="continue">Continue</option><option value="change">Change</option><option value="stop">Stop</option></select></label><label>Transition instructions / order evidence<textarea value={med.plan} onChange={(e) => setSnapshot({ ...snapshot, medications: snapshot.medications.map((item) => item.id === med.id ? { ...item, plan: e.target.value } : item) })} className="block w-full rounded border p-2"/></label></div>)}{!snapshot.medications.length && <label><input type="checkbox" checked={!!snapshot.no_medications_confirmed} onChange={(e) => setSnapshot({ ...snapshot, no_medications_confirmed: e.target.checked })}/> I verified that there are no current medications to reconcile.</label>}<Button disabled={busy || !ready} onClick={() => onSave(snapshot as never)}>Save medication reconciliation decisions</Button></>}</fieldset></div>;
}
