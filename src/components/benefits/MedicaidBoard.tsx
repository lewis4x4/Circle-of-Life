"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { dollars } from "@/lib/benefits/admission-screening";
import type { BoardRow, BoardStep, MedicaidBoard as BoardData } from "@/lib/benefits/contracts";
import { BenefitsRequestError, benefitsFetch, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export function boardDate(value: string | undefined) {
  return value ? shortDate.format(new Date(`${value}T00:00:00Z`)) : "";
}
function todayEt() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
/** COL-774: what a row past the agency steps is waiting for. */
export function phaseLabel(row: Pick<BoardRow, "phase" | "phase_days" | "renewal_date">) {
  if (row.phase === "awaiting_first_payment") return `Approved — awaiting first payment (${row.phase_days ?? 0} day${row.phase_days === 1 ? "" : "s"})`;
  if (row.phase === "renewal") {
    const days = row.phase_days ?? 0;
    return days < 0 ? `Renewal overdue since ${boardDate(row.renewal_date ?? undefined)}` : `Renewal due ${boardDate(row.renewal_date ?? undefined)} (${days} day${days === 1 ? "" : "s"})`;
  }
  return null;
}
export function revenueLabel(row: Pick<BoardRow, "revenue_not_collected_cents" | "plan_rate_cents">) {
  return row.revenue_not_collected_cents == null ? "Rate not set" : `${dollars(row.revenue_not_collected_cents)} not yet collected`;
}

type Target = { row: BoardRow; step: BoardStep; label: string };

function RecordStepDialog({ target, onClose, onSaved }: { target: Target | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const id = useId();
  const [on, setOn] = useState(todayEt());
  const [score, setScore] = useState("");
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState("");
  const [reference, setReference] = useState("");
  const [coverageStart, setCoverageStart] = useState("");
  const [renewal, setRenewal] = useState("");
  const [contribution, setContribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => { setOn(todayEt()); setScore(""); setDecision(""); setNotes(""); setPlan(""); setReference(""); setCoverageStart(""); setRenewal(""); setContribution(""); setError(null); setRequestId(crypto.randomUUID()); }, [target]);
  if (!target) return null;
  const isScore = target.step === "score";
  const isDecision = target.step === "dcf_decision";
  const isEnrolled = target.step === "plan_enrolled";
  const isAuthorized = target.step === "plan_authorized";
  const save = async () => {
    if (isScore && !score) { setError("Choose the score the agency gave."); return; }
    if (isDecision && !decision) { setError("Choose approved or denied."); return; }
    if (isEnrolled && !plan.trim()) { setError("Name the plan the resident enrolled in."); return; }
    if (isAuthorized && !coverageStart) { setError("Record the coverage start the plan authorized."); return; }
    const contributionCents = contribution.trim() ? Math.round(Number(contribution) * 100) : null;
    if (contributionCents != null && (!Number.isFinite(contributionCents) || contributionCents < 0)) { setError("Enter the resident's monthly contribution in dollars."); return; }
    const funding = {
      ...(isEnrolled ? { plan: plan.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) } : {}),
      ...(isAuthorized ? { coverage_start: coverageStart, ...(renewal ? { renewal_date: renewal } : {}), ...(contributionCents != null ? { resident_contribution_cents: contributionCents } : {}) } : {}),
    };
    if (!on || on > todayEt()) { setError("Record the date it happened; not in the future."); return; }
    setBusy(true); setError(null);
    const body = isScore
      ? { action: "record_score", payload: { score: Number(score), occurred_on: on, ...(notes.trim() ? { notes: notes.trim() } : {}) } }
      : { action: "record_step", payload: { step: target.step, occurred_on: on, ...(isDecision ? { outcome: decision } : {}), ...funding, ...(notes.trim() ? { notes: notes.trim() } : {}) } };
    try {
      await benefitsFetch(`/api/admin/benefits/board/${target.row.case_id}`, { method: "POST", body: JSON.stringify({ ...body, request_id: requestId, expected_revision: target.row.revision }) });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the step.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{target.label}: {target.row.resident_name}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="space-y-2"><FormLabel htmlFor={`${id}-on`} required>Date it happened</FormLabel><input id={`${id}-on`} type="date" max={todayEt()} className={fieldClass} value={on} onChange={(e) => setOn(e.target.value)} /></div>
          {isScore && (
            <div className="space-y-2">
              <FormLabel htmlFor={`${id}-score`} required>Score the agency gave</FormLabel>
              <select id={`${id}-score`} className={fieldClass} value={score} onChange={(e) => setScore(e.target.value)}>
                <option value="">Choose…</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}{n === 5 ? " — moves forward" : " — not approved; reapply later"}</option>)}
              </select>
            </div>
          )}
          {isDecision && (
            <div className="space-y-2">
              <FormLabel htmlFor={`${id}-decision`} required>DCF decision</FormLabel>
              <select id={`${id}-decision`} className={fieldClass} value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="">Choose…</option><option value="Approved">Approved</option><option value="Denied">Denied</option>
              </select>
              <p className="text-xs text-muted-foreground">This marks the board. Record the formal decision letter on the case to hand funding to billing.</p>
            </div>
          )}
          {isEnrolled && (
            <>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-plan`} required>Plan</FormLabel><input id={`${id}-plan`} className={fieldClass} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. UHC" /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-reference`}>Enrollment reference</FormLabel><input id={`${id}-reference`} className={fieldClass} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </>
          )}
          {isAuthorized && (
            <>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-coverage`} required>Coverage start</FormLabel><input id={`${id}-coverage`} type="date" className={fieldClass} value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-renewal`}>Renewal (redetermination) date</FormLabel><input id={`${id}-renewal`} type="date" className={fieldClass} value={renewal} onChange={(e) => setRenewal(e.target.value)} /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-contribution`}>Resident monthly contribution ($)</FormLabel><input id={`${id}-contribution`} inputMode="decimal" className={fieldClass} value={contribution} onChange={(e) => setContribution(e.target.value)} /></div>
              <p className="text-xs text-muted-foreground">These go on the case as unverified funding. The row stays on the board until the plan&apos;s first payment posts in billing.</p>
            </>
          )}
          <div className="space-y-2"><FormLabel htmlFor={`${id}-notes`}>Note (optional)</FormLabel><input id={`${id}-notes`} className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <ErrorNotice error={error} />
          <div className="flex gap-2"><Button type="submit" className="min-h-11" disabled={busy}>{busy ? "Saving…" : "Record"}</Button><Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CaseworkerSelect({ row, data, onSaved }: { row: BoardRow; data: BoardData; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  if (!data.can_write) return <span className="text-sm">{row.caseworker_name ?? "—"}</span>;
  return (
    <div className="space-y-1">
      <select aria-label={`Caseworker for ${row.resident_name}`} className={`${fieldClass} min-w-40`} value={row.caseworker_id ?? ""} onChange={async (e) => {
        setError(null);
        try {
          await benefitsFetch(`/api/admin/benefits/board/${row.case_id}`, { method: "POST", body: JSON.stringify({ action: "set_caseworker", payload: { contact_id: e.target.value || null }, request_id: crypto.randomUUID(), expected_revision: row.revision }) });
          await onSaved();
        } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to set the caseworker."); }
      }}>
        <option value="">Not set</option>
        {data.contacts.filter((c) => c.agency === "dcf").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {row.caseworker_phone && <p className="text-xs text-muted-foreground">{row.caseworker_phone}</p>}
      <ErrorNotice error={error} />
    </div>
  );
}

function RowBadges({ row }: { row: BoardRow }) {
  const phase = phaseLabel(row);
  return (
    <div className="flex flex-wrap gap-1">
      {phase ? <StatusPill tone={row.phase === "renewal" ? "warning" : "info"}>{phase}</StatusPill>
        : <StatusPill tone={row.waiting_on === "us" ? "info" : "muted"}>{row.waiting_on === "us" ? "Waiting on us" : "Waiting on agency"}</StatusPill>}
      {(row.documents_expiring ?? 0) > 0 && <StatusPill tone="warning">{row.documents_expiring === 1 ? "Document expiring" : `${row.documents_expiring} documents expiring`}</StatusPill>}
      {row.stalled && <StatusPill tone="warning">{`No step in ${row.days_since_last_step} days`}</StatusPill>}
      {row.agency_score != null && row.agency_score < 5 && row.reapply_on && <StatusPill tone="warning">{`Score ${row.agency_score}: reapply ${boardDate(row.reapply_on)}`}</StatusPill>}
    </div>
  );
}

function AddContact({ onSaved }: { onSaved: () => Promise<void> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(true)}>Add DCF caseworker</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
      event.preventDefault(); setError(null);
      try { await benefitsFetch("/api/admin/benefits/contacts", { method: "POST", body: JSON.stringify({ name: name.trim(), agency: "dcf", ...(phone.trim() ? { phone: phone.trim() } : {}) }) }); setOpen(false); setName(""); setPhone(""); await onSaved(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save the contact."); }
    }}>
      <div className="space-y-1"><FormLabel htmlFor={`${id}-name`} required>Name</FormLabel><input id={`${id}-name`} className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><FormLabel htmlFor={`${id}-phone`}>Phone</FormLabel><input id={`${id}-phone`} className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      <Button type="submit" className="min-h-11" disabled={!name.trim()}>Save</Button>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
      <ErrorNotice error={error} />
    </form>
  );
}

/** Jessica's Medicaid Log as a live board: one row per open case, one column per step. */
export function MedicaidBoard() {
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const load = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      const body = await benefitsFetch<BoardData>(`/api/admin/benefits/board?facility_id=${encodeURIComponent(facilityId)}`);
      if (!body || !Array.isArray(body.rows) || !Array.isArray(body.steps)) throw new Error("The board could not be verified. Please try again.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof BenefitsRequestError && (caught.status === 403 || caught.status === 404)
        ? "The Medicaid board is visible to staff with Medicaid access for this facility. Ask an owner to grant access under Medicaid & benefits → Access."
        : caught instanceof Error ? caught.message : "Unable to load the board.");
    }
  }, [facilityId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const totals = useMemo(() => {
    if (!data) return null;
    const known = data.rows.filter((r) => r.revenue_not_collected_cents != null);
    return { stalled: data.rows.filter((r) => r.stalled).length, owed: known.reduce((sum, r) => sum + (r.revenue_not_collected_cents ?? 0), 0), unknown: data.rows.length - known.length };
  }, [data]);
  const stepLabel = (step: BoardStep) => data?.steps.find((s) => s.step === step)?.label ?? step;
  const cell = (row: BoardRow, step: BoardStep) => {
    const on = row.step_dates[step];
    if (on) return <span className="whitespace-nowrap text-sm">{step === "score" && row.agency_score ? `${row.agency_score} · ` : ""}{boardDate(on)}</span>;
    if (row.next_step === step && data?.can_write) return <Button size="sm" variant="outline" className="min-h-11 whitespace-nowrap" onClick={() => setTarget({ row, step, label: stepLabel(step) })}>Record</Button>;
    return <span className="text-muted-foreground" aria-label="Not yet">·</span>;
  };

  return (
    <Panel title="Medicaid board" description="Jessica's Medicaid Log, live: one row per open long-term-care case, one column per step. Record the next step in one click; dates come from the case record.">
      {!facilityId && <FacilityGateNotice reason="Jessica's log is kept per building, so the Medicaid board shows one facility at a time." />}
      <ErrorNotice error={error} />
      {facilityId && !data && !error && <p role="status">Loading the board…</p>}
      {data && totals && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{data.facility_name}</span>
            <span>{data.rows.length} open case{data.rows.length === 1 ? "" : "s"}</span>
            {totals.stalled > 0 && <StatusPill tone="warning">{`${totals.stalled} stalled`}</StatusPill>}
            <span>{dollars(totals.owed)} not yet collected{totals.unknown ? ` (+${totals.unknown} with no rate set)` : ""}</span>
            {data.rechecks_due > 0 && <Link className="underline" href={`/admin/benefits?view=rechecks&facility_id=${data.facility_id}`}>{data.rechecks_due} recheck{data.rechecks_due === 1 ? "" : "s"} due</Link>}
          </div>
          {data.needs_answers.length > 0 && (
            <p className="text-sm">Needs answers before Medicaid can be decided: {data.needs_answers.map((r) => r.resident_name).join(", ")}.</p>
          )}
          {data.rows.length === 0 ? <p className="text-sm text-muted-foreground">No open long-term-care Medicaid cases at this facility.</p> : (
            <>
              <div className="hidden md:block">
                <Table aria-label={`Medicaid board for ${data.facility_name}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-card">Resident</TableHead>
                      {data.steps.map((s) => <TableHead key={s.step} className="whitespace-nowrap">{s.label}</TableHead>)}
                      <TableHead>DCF caseworker</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TableRow key={row.case_id}>
                        <TableCell className="sticky left-0 z-10 min-w-56 bg-card align-top">
                          <Link className="font-medium underline-offset-2 hover:underline" href={`/admin/benefits/${row.case_id}`}>{row.resident_name}</Link>
                          <p className="text-xs text-muted-foreground">{revenueLabel(row)}</p>
                          <RowBadges row={row} />
                        </TableCell>
                        {data.steps.map((s) => <TableCell key={s.step} className="align-top">{cell(row, s.step)}</TableCell>)}
                        <TableCell className="align-top"><CaseworkerSelect row={row} data={data} onSaved={load} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-3 md:hidden">
                {data.rows.map((row) => (
                  <li key={row.case_id} className="space-y-2 rounded-[var(--radius)] border border-border p-3">
                    <Link className="font-medium" href={`/admin/benefits/${row.case_id}`}>{row.resident_name}</Link>
                    <p className="text-xs text-muted-foreground">{revenueLabel(row)}</p>
                    <RowBadges row={row} />
                    {row.next_step ? (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>Next: {stepLabel(row.next_step)}</span>
                        {data.can_write && <Button size="sm" className="min-h-11" onClick={() => setTarget({ row, step: row.next_step!, label: stepLabel(row.next_step!) })}>Record</Button>}
                      </div>
                    ) : !phaseLabel(row) && <p className="text-sm">All steps recorded.</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.can_write && <AddContact onSaved={load} />}
        </>
      )}
      <RecordStepDialog target={target} onClose={() => setTarget(null)} onSaved={load} />
    </Panel>
  );
}
