"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { StatusPill } from "@/components/ui/status-pill";
import { dollars } from "@/lib/benefits/admission-screening";
import type { MedicaidPrompts as PromptsData, PromptKind } from "@/lib/benefits/contracts";
import { BenefitsRequestError, benefitsFetch, dateLabel, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

export function runwayWords(daysLeft: number) {
  if (daysLeft < 0) return `Private pay ran out ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "Private pay runs out today";
  return `Private pay runs out in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

function PromptActions({ residentId, kind, onDone }: { residentId: string; kind: PromptKind; onDone: () => Promise<void> }) {
  const id = useId();
  const router = useRouter();
  const [aside, setAside] = useState(false);
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const reply = await benefitsFetch<{ case_id: string }>("/api/admin/benefits/prompts/start", { method: "POST", body: JSON.stringify({ request_id: requestId, resident_id: residentId, kind }) });
      router.push(`/admin/benefits/${reply.case_id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start the case."); setBusy(false); }
  };
  const setAsideNow = async () => {
    if (!/^\d{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 180) { setError("Set it aside for 1 to 180 days."); return; }
    setBusy(true); setError(null);
    try {
      await benefitsFetch("/api/admin/benefits/prompts/dismiss", { method: "POST", body: JSON.stringify({ request_id: requestId, resident_id: residentId, kind, days: Number(days), reason: reason.trim() }) });
      setRequestId(crypto.randomUUID()); setAside(false);
      await onDone();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to set the prompt aside."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      {!aside && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start Medicaid case"}</Button>
          <Button variant="outline" className="min-h-11" onClick={() => setAside(true)}>Not now</Button>
        </div>
      )}
      {aside && (
        <form className="grid gap-3 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-[8rem_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void setAsideNow(); }}>
          <div className="space-y-2"><FormLabel htmlFor={`${id}-days`} required>For how many days</FormLabel><input id={`${id}-days`} className={fieldClass} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div className="space-y-2"><FormLabel htmlFor={`${id}-reason`} required>Reason</FormLabel><input id={`${id}-reason`} className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="flex items-end gap-2">
            <Button type="submit" className="min-h-11" disabled={busy || !reason.trim()}>Set aside</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setAside(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

/** Jessica's prompts: residents whose private pay is ending, and (once payments live in Haven) residents paying late. */
export function MedicaidPromptsPanel() {
  const [data, setData] = useState<PromptsData | null>(null);
  const [error, setError] = useState<{ message: string; noAccess: boolean } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await benefitsFetch<PromptsData>("/api/admin/benefits/prompts");
      if (!body || !Array.isArray(body.runway) || !Array.isArray(body.late_payments) || !Array.isArray(body.late_signal)) throw new Error("Prompts could not be verified. Please try again.");
      setData(body);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "Unable to load prompts.", noAccess: caught instanceof BenefitsRequestError && (caught.status === 403 || caught.status === 404) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error?.noAccess) return null;
  const off = data?.late_signal.filter((f) => !f.live) ?? [];
  return (
    <Panel title="Start before the money runs out" description="Residents whose private pay is ending, and residents falling behind on private-pay invoices. Prompts for staff only; nothing is sent to residents or families.">
      {error && <ErrorNotice error={error.message} />}
      {!data && !error && <p role="status">Loading prompts…</p>}
      {data && (
        <>
          {data.runway.length === 0 && data.late_payments.length === 0 && <p className="text-sm text-muted-foreground">No residents need a Medicaid case started right now.</p>}
          {data.runway.length > 0 && (
            <ul className="divide-y divide-border" aria-label="Private pay ending">
              {data.runway.map((p) => (
                <li key={`r-${p.resident_id}`} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-medium">{p.resident_name}</p><p className="text-sm text-muted-foreground">{p.facility_name} · expected {dateLabel(p.runway_date)}</p></div>
                    <StatusPill tone={p.days_left <= 30 ? "warning" : "muted"}>{runwayWords(p.days_left)}</StatusPill>
                  </div>
                  {p.can_write && <PromptActions residentId={p.resident_id} kind="runway" onDone={load} />}
                </li>
              ))}
            </ul>
          )}
          {data.late_payments.length > 0 && (
            <ul className="divide-y divide-border" aria-label="Late private payments">
              {data.late_payments.map((p) => (
                <li key={`l-${p.resident_id}`} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-medium">{p.resident_name}</p><p className="text-sm text-muted-foreground">{p.facility_name} · two private-pay invoices past due since {dateLabel(p.oldest_due)}</p></div>
                    <StatusPill tone="warning">{dollars(p.owed_cents)} owed</StatusPill>
                  </div>
                  {p.can_write && <PromptActions residentId={p.resident_id} kind="late_payments" onDone={load} />}
                </li>
              ))}
            </ul>
          )}
          {off.length > 0 && (
            <p className="text-xs text-muted-foreground">Late-payment prompts are off at {off.map((f) => f.facility_name).join(", ")} because payments are not recorded in Haven there yet (they are still in QuickBooks).</p>
          )}
        </>
      )}
    </Panel>
  );
}
