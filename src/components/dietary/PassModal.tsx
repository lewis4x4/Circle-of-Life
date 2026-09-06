"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { TrayTicket } from "./types";

export function PassModal({ ticket, onClose, onSaved }: { ticket: TrayTicket | null; onClose: () => void; onSaved?: () => void }) {
  const [resident, setResident] = useState("");
  const [food, setFood] = useState("");
  const [liquid, setLiquid] = useState("");
  const [allergens, setAllergens] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ticket) return null;
  async function save() {
    if (!ticket || saving) return;
    setError(null);
    if (resident.trim().toLowerCase() !== ticket.resident_name.trim().toLowerCase() || food === "" || liquid === "" || !allergens) {
      setError("Confirm the resident, checked food and liquid levels, and allergen precautions."); return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dietary/tray-pass", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: ticket.id, residentId: ticket.resident_id, foodLevel: Number(food), liquidLevel: Number(liquid), allergensConfirmed: allergens }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Tray pass was not saved.");
      setSaved(true);
      onSaved?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Tray pass was not saved."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="dark bg-background text-foreground">
      <DialogHeader><DialogTitle>Verify tray · {ticket.resident_name}</DialogTitle>
        <DialogDescription>Manual check against the current diet order. No barcode scan or clinical override is performed here.</DialogDescription></DialogHeader>
      {saved ? <p role="status">Tray pass saved. The resident, checks, operator and time were recorded.</p> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p>Room {ticket.room} · {ticket.diet_label} · Food level {ticket.iddsi_level} · Liquid level {ticket.iddsi_liquid_level ?? "not recorded"}</p>
        <p>Allergens: {ticket.allergens.length ? ticket.allergens.join(", ") : "None listed on tray snapshot; verify the current order."}</p>
        <p>{ticket.menu_items.join(" · ")}</p>
        <label className="block">Resident name checked<input className="block w-full rounded border p-2" value={resident} onChange={(e) => setResident(e.target.value)} required /></label>
        <label className="block">Food level checked<input className="block w-full rounded border p-2" type="number" min="0" max="7" value={food} onChange={(e) => setFood(e.target.value)} required /></label>
        <label className="block">Liquid level checked<input className="block w-full rounded border p-2" type="number" min="0" max="4" value={liquid} onChange={(e) => setLiquid(e.target.value)} required /></label>
        <label className="flex gap-2"><input type="checkbox" checked={allergens} onChange={(e) => setAllergens(e.target.checked)} />Allergens and cross-contact precautions checked</label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <p className="text-sm text-muted-foreground">If any check does not match, stop and contact the nurse before serving.</p>
        <button className="rounded border px-3 py-2" disabled={saving} type="submit">{saving ? "Saving…" : "Record tray pass"}</button>
      </form>}
    </DialogContent>
  </Dialog>;
}
