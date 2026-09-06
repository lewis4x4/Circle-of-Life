"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { MedPassItem } from "../PassCard";

export function MedPassModal({ pass, onClose, onSaved }: { pass: MedPassItem; onClose: () => void; onSaved?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<"given" | "held" | "refused">("given");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [witnessEmail, setWitnessEmail] = useState("");
  const [witnessPassword, setWitnessPassword] = useState("");
  const [witnessed, setWitnessed] = useState(false);

  async function witness() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/med-tech/passes/${pass.id}/witness`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: witnessEmail, password: witnessPassword }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Witness verification failed");
      setWitnessed(true); setWitnessPassword("");
    } catch (e) { setError(e instanceof Error ? e.message : "Witness verification failed"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (busy || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const { data, error: writeError } = await supabase.rpc("complete_med_pass_review" as never, { p_pass_id: pass.id, p_status: status, p_reason: reason, p_checks_confirmed: confirmed } as never);
      if (writeError) throw writeError;
      if (typeof data !== "string") throw new Error("No saved MAR receipt was returned. Refresh before retrying.");
      setReceipt(data); onSaved?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save medication action"); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="med-pass-title">
    <div className="w-full max-w-xl space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6 text-white">
      <h2 id="med-pass-title" className="text-xl font-semibold">{pass.resident} · Medication confirmation</h2>
      <p>{pass.med} · {pass.dose} · Scheduled {pass.time}</p>
      {receipt ? <div role="status" className="space-y-2"><p>Saved to the MAR: {status}.</p><p className="text-xs text-slate-400">Record {receipt}</p><Button onClick={onClose}>Return to pass</Button></div> : <>
        <p className="text-sm text-slate-300">Review the current order, resident identity, allergies, route, dose, time and any hold instructions before recording the action you actually performed. Saving checks current order status and active holds.</p>
        {pass.hold && <p role="alert" className="text-amber-200">Hold: {pass.hold}</p>}
        <label className="block">Actual action<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 block w-full rounded border border-slate-600 bg-slate-800 p-3"><option value="given">Given</option><option value="refused">Refused</option><option value="held">Held</option></select></label>
        <label className="block">Indication, exception reason or notes<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded border border-slate-600 bg-slate-800 p-3" /></label>
        <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>I checked the resident and order and confirm the actual action above.</span></label>
        {(pass.controlled || pass.witnessRequired) && status === "given" && <fieldset className="space-y-2 rounded border border-slate-600 p-3"><legend>Independent witness</legend>{witnessed ? <p>Witness signature saved.</p> : <><label className="block">Witness email<input type="email" autoComplete="off" value={witnessEmail} onChange={(e) => setWitnessEmail(e.target.value)} className="block w-full bg-slate-800 p-2" /></label><label className="block">Witness password<input type="password" autoComplete="off" value={witnessPassword} onChange={(e) => setWitnessPassword(e.target.value)} className="block w-full bg-slate-800 p-2" /></label><Button disabled={busy || !witnessEmail || !witnessPassword} onClick={() => void witness()}>Save witness signature</Button></>}</fieldset>}
        {error && <p role="alert" className="text-rose-200">{error}</p>}
        <div className="flex gap-3"><Button disabled={busy || !confirmed || (status !== "given" && !reason.trim())} onClick={() => void save()}>{busy ? "Saving…" : "Save to MAR"}</Button><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button></div>
      </>}
    </div>
  </div>;
}
