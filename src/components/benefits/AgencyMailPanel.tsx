"use client";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { StatusPill } from "@/components/ui/status-pill";
import { BENEFITS_AGENCIES, BENEFITS_EVENT_TYPES, type MailItem, type MailList } from "@/lib/benefits/contracts";
import { benefitsFetch, dateLabel, ErrorNotice, fieldClass, label } from "./benefits-ui";

const AGENCY_LABEL: Record<(typeof BENEFITS_AGENCIES)[number], string> = { dcf: "DCF", cares: "CARES", elder_options: "Elder Options", plan: "Plan", other: "Other" };

function ConfirmForm({ item, cases, onDone, onCancel }: { item: MailItem; cases: Array<{ case_id: string; resident_name: string }>; onDone: () => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [caseId, setCaseId] = useState(item.proposed_case_id ?? "");
  const [agency, setAgency] = useState<string>(item.proposed_agency ?? "");
  const [eventType, setEventType] = useState("correspondence");
  const [outcome, setOutcome] = useState(item.subject?.slice(0, 200) ?? "");
  const [letterDate, setLetterDate] = useState(item.proposed_letter_date ?? "");
  const [dueOn, setDueOn] = useState(item.proposed_due_on ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <form className="grid gap-3 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      try {
        await benefitsFetch(`/api/admin/benefits/mail/${item.id}/confirm`, { method: "POST", body: JSON.stringify({ request_id: requestId, case_id: caseId, agency, event_type: eventType, outcome: outcome.trim(), letter_date: letterDate, due_on: dueOn || null }) });
        await onDone();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to confirm."); } finally { setBusy(false); }
    }}>
      <p className="text-sm text-muted-foreground sm:col-span-2">Check what Haven read from the letter. Confirming records it on the case and sets the response deadline.</p>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-case`} required>Case</FormLabel>
        <select id={`${id}-case`} className={fieldClass} value={caseId} onChange={(e) => setCaseId(e.target.value)}><option value="">Choose…</option>{cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.resident_name}</option>)}</select></div>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-agency`} required>Agency</FormLabel>
        <select id={`${id}-agency`} className={fieldClass} value={agency} onChange={(e) => setAgency(e.target.value)}><option value="">Choose…</option>{BENEFITS_AGENCIES.map((a) => <option key={a} value={a}>{AGENCY_LABEL[a]}</option>)}</select></div>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-type`} required>Kind of letter</FormLabel>
        <select id={`${id}-type`} className={fieldClass} value={eventType} onChange={(e) => setEventType(e.target.value)}>{BENEFITS_EVENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-outcome`} required>What it says (short)</FormLabel><input id={`${id}-outcome`} className={fieldClass} maxLength={200} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></div>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-date`} required>Date printed on the letter</FormLabel><input id={`${id}-date`} type="date" className={fieldClass} value={letterDate} onChange={(e) => setLetterDate(e.target.value)} /></div>
      <div className="space-y-2"><FormLabel htmlFor={`${id}-due`}>Respond by</FormLabel><input id={`${id}-due`} type="date" className={fieldClass} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></div>
      <div className="sm:col-span-2"><ErrorNotice error={error} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" className="min-h-11" disabled={busy || !caseId || !agency || !outcome.trim() || !letterDate}>{busy ? "Saving…" : "Confirm"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function DismissForm({ item, onDone, onCancel }: { item: MailItem; onDone: () => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
      event.preventDefault(); setError(null);
      try { await benefitsFetch(`/api/admin/benefits/mail/${item.id}/dismiss`, { method: "POST", body: JSON.stringify({ request_id: requestId, reason: reason.trim() }) }); await onDone(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to dismiss."); }
    }}>
      <div className="space-y-1"><FormLabel htmlFor={`${id}-reason`} required>Reason</FormLabel><input id={`${id}-reason`} className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not about a resident" /></div>
      <Button type="submit" className="min-h-11" disabled={!reason.trim()}>Dismiss</Button>
      <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>Cancel</Button>
      <ErrorNotice error={error} />
    </form>
  );
}

/** Letters forwarded to the facility's Medicaid inbox, waiting for a person to confirm or dismiss. */
export function AgencyMailPanel({ facilityId, cases }: { facilityId: string; cases: Array<{ case_id: string; resident_name: string }> }) {
  const [data, setData] = useState<MailList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: "confirm" | "dismiss" } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await benefitsFetch<MailList>(`/api/admin/benefits/mail?facility_id=${encodeURIComponent(facilityId)}`);
      if (!body || !Array.isArray(body.items)) throw new Error("Agency mail could not be verified.");
      setData(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load agency mail."); }
  }, [facilityId]);
  useEffect(() => { void load(); }, [load]);
  const done = async () => { setOpen(null); await load(); };
  if (!data && !error) return null;
  return (
    <section aria-label="Agency mail" className="space-y-3 rounded-[var(--radius)] border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Agency mail</h3>
        {data && data.inboxes.length > 0 && <span className="text-xs text-muted-foreground">Forward DCF, CARES, Elder Options and plan letters to {data.inboxes.map((i) => i.email).join(", ")}</span>}
      </div>
      <ErrorNotice error={error} />
      {data && data.inboxes.length === 0 && <p className="text-sm text-muted-foreground">No Medicaid inbox is set up for this facility yet.</p>}
      {data && data.inboxes.length > 0 && data.items.length === 0 && <p className="text-sm text-muted-foreground">No forwarded letters waiting.</p>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border">
          {data.items.map((item) => (
            <li key={item.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.subject || "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground">Received {dateLabel(item.received_at)}{item.proposed_agency ? ` · ${AGENCY_LABEL[item.proposed_agency]}` : ""}{item.proposed_due_on ? ` · respond by ${dateLabel(item.proposed_due_on)}` : ""}</p>
                </div>
                <StatusPill tone={item.status === "proposed" ? "info" : "warning"}>{item.status === "proposed" ? `Looks like ${item.proposed_resident_name}` : "No case matched"}</StatusPill>
              </div>
              {item.preview && <p className="line-clamp-3 text-sm text-muted-foreground">{item.preview}</p>}
              {item.attachments.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {item.attachments.map((a) => (
                    <li key={a.id}>{a.status === "stored" ? <a className="underline" href={`/api/admin/benefits/mail/attachments/${a.id}`}>{a.filename}</a> : <span className="text-muted-foreground">{a.filename} (not stored: {label(a.status)})</span>}</li>
                  ))}
                </ul>
              )}
              {data.can_write && !open && (
                <div className="flex gap-2">
                  <Button className="min-h-11" onClick={() => setOpen({ id: item.id, mode: "confirm" })}>Confirm</Button>
                  <Button variant="outline" className="min-h-11" onClick={() => setOpen({ id: item.id, mode: "dismiss" })}>Dismiss</Button>
                </div>
              )}
              {open?.id === item.id && open.mode === "confirm" && <ConfirmForm item={item} cases={cases} onDone={done} onCancel={() => setOpen(null)} />}
              {open?.id === item.id && open.mode === "dismiss" && <DismissForm item={item} onDone={done} onCancel={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
