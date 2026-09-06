"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Manual input shares the durable temperature log; voice is not simulated. */
export function VoiceModal({ open, onClose, facilityId, onSaved }: { open: boolean; onClose: () => void; facilityId?: string | null; onSaved?: () => void }) {
  const [id] = useState(() => crypto.randomUUID());
  const [item, setItem] = useState("");
  const [type, setType] = useState("hot_hold");
  const [temperature, setTemperature] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    if (saving || !facilityId) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/dietary/temperature", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, facilityId, item, logType: type, temperature: Number(temperature), minimum: Number(minimum), maximum: Number(maximum), correctiveAction: action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Temperature was not saved.");
      setSaved(true); onSaved?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Temperature was not saved."); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !saving) onClose(); }}><DialogContent className="dark bg-background text-foreground">
    <DialogHeader><DialogTitle>Record temperature</DialogTitle><DialogDescription>Enter the measured reading and the limits from your approved kitchen procedure.</DialogDescription></DialogHeader>
    {saved ? <p role="status">Temperature log saved.</p> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block">Item<input className="block w-full rounded border p-2" required value={item} onChange={(e) => setItem(e.target.value)} /></label>
      <label className="block">Check type<select className="block w-full rounded border p-2" value={type} onChange={(e) => setType(e.target.value)}>{["hot_hold","cold_hold","cooking","cooling","reheating","receiving","fridge_temp","freezer_temp","dishmachine","sanitizer"].map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Measured temperature °F<input className="block w-full rounded border p-2" type="number" step="0.1" required value={temperature} onChange={(e) => setTemperature(e.target.value)} /></label>
      <label className="block">Approved minimum °F<input className="block w-full rounded border p-2" type="number" step="0.1" required value={minimum} onChange={(e) => setMinimum(e.target.value)} /></label>
      <label className="block">Approved maximum °F<input className="block w-full rounded border p-2" type="number" step="0.1" required value={maximum} onChange={(e) => setMaximum(e.target.value)} /></label>
      <label className="block">Corrective action<textarea className="block w-full rounded border p-2" value={action} onChange={(e) => setAction(e.target.value)} /></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <button className="rounded border px-3 py-2" disabled={saving || !facilityId} type="submit">{saving ? "Saving…" : "Save temperature log"}</button>
    </form>}
  </DialogContent></Dialog>;
}
