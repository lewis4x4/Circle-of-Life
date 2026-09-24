"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlannedScheduleContext } from "@/components/timeclock/PlannedScheduleContext";
import { fromZonedTime } from "date-fns-tz";
import { addFacilityCalendarDays } from "@/lib/facility-wall-clock";
import { FacilityGate, useFacilityGateScope } from "@/components/common/FacilityGate";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import { enumLabel } from "@/lib/display/enum-label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { PacketDetail as Detail, PacketInput, PacketRow, PayrollPacket, PayrollPolicy } from "@/lib/payroll-packets/types";
import { dollars, fieldClass, hours, panelClass, request, statusLabel, useDraftGuard } from "./shared";

function editableRows(packet: PayrollPacket): PacketInput[] {
  return packet.snapshot.rows.map(({ staffId, payrollId, payBasis, department, regularMinutes, overtimeMinutes, holidayMinutes, personalMinutes, trainingMinutes, onCallCents, bonusCents, salaryCents, note, reason, reviewed }) => ({ staffId, payrollId, payBasis, department, regularMinutes, overtimeMinutes, holidayMinutes, personalMinutes, trainingMinutes, onCallCents, bonusCents, salaryCents, note, reason, reviewed }));
}
export default function PacketDetail({ id }: { id: string }) {
  const { facilityId } = useFacilityGateScope();
  return <FacilityGate title="Payroll packet" reason="Review and approve payroll within its facility.">{facilityId && <ScopedDetail key={`${id}-${facilityId}`} id={id} facilityId={facilityId} />}</FacilityGate>;
}
function ScopedDetail({ id, facilityId }: { id: string; facilityId: string }) {
  const { appRole } = useHavenAuth();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [inputs, setInputs] = useState<PacketInput[]>([]);
  const [checkDate, setCheckDate] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [actionForm, setActionForm] = useState<"report" | "reconcile" | "difference" | "amend" | null>(null);
  const [method, setMethod] = useState<"" | "phone" | "run">("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  useDraftGuard(dirty || (actionForm !== null && (note !== "" || method !== "")), busy);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    request<Detail>(`/api/admin/payroll-packets/${id}`, { signal: controller.signal }).then((result) => { if (controller.signal.aborted) return; setData(result); setInputs(editableRows(result.packet)); setCheckDate(result.packet.check_date); setDirty(false); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load packet."); });
    return () => controller.abort();
  }, [id, refresh]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      const result = await request<{ packet: PayrollPacket }>(`/api/admin/payroll-packets/${id}`, { method: "PATCH", body: JSON.stringify({ action, expectedRevision: data.packet.revision, ...extra }) });
      setDirty(false); setActionForm(null); setNote(""); setMethod(""); setAttested(false);
      if (action === "amend") { setBusy(false); router.push(`/admin/payroll/packets/${result.packet.id}`); return; }
      setData(null); setRefresh((value) => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update packet."); }
    finally { setBusy(false); }
  }
  const back = <Link href="/admin/payroll" className="text-sm text-primary underline">All payroll packets</Link>;
  if (!data) return <div className="space-y-4">{back}{error ? <div role="alert">{error}<Button className="ml-3" variant="outline" onClick={() => setRefresh((n) => n + 1)}>Retry</Button></div> : <p role="status">Loading payroll packet…</p>}</div>;
  if (data.packet.facility_id !== facilityId) return <div className="space-y-4">{back}<p>This packet belongs to a different facility. Open it from that facility’s payroll page.</p></div>;
  const { packet, stale } = data;
  const draft = packet.status === "draft";
  const policy = packet.snapshot.policy;
  const canApprove = ["owner", "org_admin"].includes(appRole) || (appRole === "facility_admin" && policy?.approvalRole === "facility");
  const canEdit = ["owner", "org_admin", "facility_admin"].includes(appRole);
  const updateRow = (staffId: string, patch: Partial<PacketInput>) => { setInputs((old) => old.map((row) => row.staffId === staffId ? { ...row, reviewed: false, ...patch } : row)); setDirty(true); setAttested(false); };
  const openAction = (action: typeof actionForm) => { if (action && actionForm && (note || method) && !window.confirm("Discard the unfinished payroll record?")) return; setActionForm(action); setNote(""); setMethod(""); setAttested(false); };
  const total = packet.snapshot.totals;
  return <div className="space-y-6">
    {back}
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Payroll packet <span className="text-xl text-muted-foreground">v{packet.version}</span></h1><p className="mt-2">{packet.snapshot.facilityName} · {packet.period_start} – {packet.period_end}</p><p className="mt-1 text-sm text-muted-foreground">Check date {packet.check_date} · {statusLabel(packet.status)}{packet.snapshot.employerName ? ` · ${packet.snapshot.employerName}` : " · Employer not confirmed"}</p></div><div className="flex flex-wrap gap-2">{([['html', 'Print / view'], ['pdf', 'Download PDF'], ['csv', 'Download CSV']] as const).map(([format, label]) => <a key={format} className={buttonVariants({ variant: "outline" })} href={`/api/admin/payroll-packets/${id}/document?format=${format}`} target="_blank" rel="noreferrer">{label}{draft ? " (draft)" : ""}</a>)}</div></header>
    {error && <p role="alert" className={`${panelClass} text-destructive`}>{error}</p>}
    {packet.amendment_reason && <p className={panelClass}>Amendment reason: {packet.amendment_reason}</p>}
    {draft && <section className={panelClass}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Review draft</h2><p className="mt-1 text-sm text-muted-foreground">{dirty ? "Unsaved changes. Save to recalculate totals and approval checks." : "Totals and checks reflect the saved draft."}</p></div>{canEdit && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || dirty} onClick={() => void act("refresh")}>Refresh timecards and rules</Button><Button disabled={busy || !dirty || !checkDate || checkDate < packet.period_end} onClick={() => void act("save", { inputs, checkDate })}>Save changes</Button></div>}</div>
      {canEdit && <label className="mt-4 block max-w-xs space-y-1 text-sm"><span>Check date</span><input aria-label="Check date" required type="date" className={fieldClass} min={packet.period_end} value={checkDate} disabled={busy} onChange={(event) => { setCheckDate(event.target.value); setDirty(true); setAttested(false); }} /><span className="block text-xs text-muted-foreground">Correct the check date before approval. The pay period stays unchanged.</span></label>}
      {stale && <p role="alert" className="mt-3 font-medium text-destructive">Timecards or payroll rules have changed. Save any edits, then refresh this draft before approval.</p>}
      {packet.snapshot.blockers.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Before approval</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{packet.snapshot.blockers.map((blocker, i) => <li key={i}>{blocker}</li>)}</ul></div>}
      {packet.snapshot.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{packet.snapshot.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <p className="mt-3 text-sm text-muted-foreground">{policy?.calculationMode === "reviewed" ? "Enter final payroll-reviewed regular and overtime hours with the allocation reason. Raw kiosk hours remain visible separately." : "Regular and overtime hours come from timecards. Training reclassifies worked hours; holiday and personal leave are additional paid hours."}</p>
    </section>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Saved payroll totals">{[["Worked hours", hours(total.workedMinutes)], ["Paid hours", hours(total.paidMinutes)], ["Overtime", hours(total.overtimeMinutes)], ["On call / bonus", `${dollars(total.onCallCents)} / ${dollars(total.bonusCents)}`]].map(([label, value]) => <div key={label} className={panelClass}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</section>
    {policy?.timeZone && <PlannedScheduleContext facilityIds={[facilityId]} from={fromZonedTime(`${packet.period_start}T00:00:00`, policy.timeZone).toISOString()} to={fromZonedTime(`${addFacilityCalendarDays(packet.period_end, 1, policy.timeZone)}T00:00:00`, policy.timeZone).toISOString()} compact payroll />}
    {(["administration", "operations"] as const).map((department) => {
      const members = packet.snapshot.rows.filter((row) => (inputs.find((input) => input.staffId === row.staffId)?.department ?? row.department) === department);
      return <section key={department} className="space-y-3"><h2 className="text-lg font-semibold">{statusLabel(department)}</h2>{members.length === 0 ? <p className="text-sm text-muted-foreground">No employees in this group.</p> : members.map((row) => <EmployeeRow key={row.staffId} row={row} input={inputs.find((item) => item.staffId === row.staffId) ?? row} editable={draft && canEdit && !busy} policy={policy} onChange={(patch) => updateRow(row.staffId, patch)} />)}</section>;
    })}
    {draft && canApprove && <section className={panelClass}><h2 className="font-semibold">Approve and freeze packet</h2><p className="mt-2 text-sm">Approval freezes this version and its documents. Changes afterward require an amendment.</p><label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} disabled={busy || dirty || stale || packet.snapshot.blockers.length > 0} onChange={(e) => setAttested(e.target.checked)} />I reviewed the employees, hours, amounts, period and check date and authorize this packet for payroll entry.</label><Button className="mt-4" disabled={busy || dirty || stale || !attested || packet.snapshot.blockers.length > 0} onClick={() => void act("approve")}>Approve packet</Button></section>}
    {draft && !canApprove && <p className="text-sm text-muted-foreground">This facility’s configured payroll approver must approve the packet.</p>}
    {!draft && <section className={panelClass}><h2 className="font-semibold">Approved payroll record</h2><p className="mt-2 text-sm">Approved by {packet.approved_by_name ?? "recorded approver"}{packet.approved_at ? ` on ${formatDisplayDateTime(packet.approved_at, { timeZone: policy?.timeZone })}` : ""}. This version is read only.</p>{packet.reported_at && <p className="mt-2 text-sm">Reported via {packet.report_method === "phone" ? "phone" : "RUN entry"} on {formatDisplayDateTime(packet.reported_at, { timeZone: policy?.timeZone })} · {packet.reported_by_name ?? "Recorded operator"} · {packet.report_reference}</p>}{packet.reconciled_at && <p className="mt-2 text-sm">Reconciled on {formatDisplayDateTime(packet.reconciled_at, { timeZone: policy?.timeZone })} · {packet.reconciled_by_name ?? "Recorded reviewer"} · {packet.reconciliation_note}</p>}{canEdit && <div className="mt-4 flex flex-wrap gap-2">{packet.status === "approved" && <Button disabled={busy} onClick={() => openAction("report")}>Record phone call / RUN entry</Button>}{packet.status === "reported" && <><Button disabled={busy} onClick={() => openAction("reconcile")}>Reconcile with ADP</Button><Button variant="outline" disabled={busy} onClick={() => openAction("difference")}>Record a difference</Button></>}<Button variant="outline" disabled={busy} onClick={() => openAction("amend")}>Create amendment</Button></div>}</section>}
    {actionForm && <form className={panelClass} onSubmit={(event) => { event.preventDefault(); if (actionForm === "report") void act("report", { method, reference: note }); else if (actionForm === "amend") void act("amend", { reason: note }); else void act(actionForm, { note, ...(actionForm === "reconcile" ? { matches: true } : {}) }); }}><h2 className="font-semibold">{actionForm === "report" ? "Record completed payroll entry" : actionForm === "reconcile" ? "Reconcile with ADP confirmation" : actionForm === "difference" ? "Record an unresolved difference" : "Create a new draft amendment"}</h2><fieldset disabled={busy} className="mt-4 space-y-4">{actionForm === "report" && <label className="block space-y-1 text-sm"><span>How was payroll reported?</span><select required className={fieldClass} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="">Choose…</option><option value="phone">Phone call</option><option value="run">RUN online entry</option></select></label>}<label className="block space-y-1 text-sm"><span>{actionForm === "report" ? "Confirmation reference / call notes" : actionForm === "amend" ? "Reason for amendment" : "Reconciliation notes / reference"}</span><textarea required className={fieldClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>{actionForm === "reconcile" && <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />I compared the ADP preview or confirmation with this packet and all employees, hours and amounts match.</label>}<p className="text-sm text-muted-foreground">{actionForm === "report" ? "This records entry already completed outside Haven. It does not submit to ADP." : actionForm === "difference" ? "The packet remains reported until the difference is resolved and reconciliation is completed." : actionForm === "amend" ? "The approved original stays available. Review, approve and report the amendment separately." : "Record a difference instead if any item does not match."}</p><div className="flex gap-2"><Button type="submit" disabled={busy || !note.trim() || (actionForm === "report" && !method) || (actionForm === "reconcile" && !attested)}>{busy ? "Saving…" : "Save record"}</Button><Button variant="outline" type="button" disabled={busy} onClick={() => openAction(null)}>Cancel</Button></div></fieldset></form>}
    <section className={panelClass}><h2 className="font-semibold">Version history</h2><div className="mt-3 flex flex-wrap gap-4">{data.versions.map((version) => <Link key={version.id} href={`/admin/payroll/packets/${version.id}`} className="text-sm text-primary underline" aria-current={version.id === id ? "page" : undefined}>Version {version.version} · {statusLabel(version.status)}</Link>)}</div><ol className="mt-4 space-y-2 text-sm text-muted-foreground">{data.events.map((event) => <li key={event.id}>{formatDisplayDateTime(event.created_at, { timeZone: policy?.timeZone })} · {statusLabel(event.action)}{event.actor_name ? ` · ${event.actor_name}` : ""}{typeof event.detail.note === "string" ? ` · ${event.detail.note}` : ""}</li>)}</ol></section>
  </div>;
}

type EmployeeProps = { row: PacketRow; input: PacketInput; editable: boolean; policy: Partial<PayrollPolicy> | null; onChange: (patch: Partial<PacketInput>) => void };
function EmployeeRow({ row, input, editable, policy, onChange }: EmployeeProps) {
  const numeric = (label: string, key: "regularMinutes" | "overtimeMinutes" | "holidayMinutes" | "personalMinutes" | "trainingMinutes" | "onCallCents" | "bonusCents" | "salaryCents", unit: "hours" | "dollars", disabled = false) => {
    const value = input[key]; const factor = unit === "hours" ? 60 : 100;
    return <label className="space-y-1 text-sm"><span>{label} ({unit})</span><input aria-label={`${row.name}: ${label}`} className={fieldClass} type="number" min="0" step="0.01" disabled={!editable || disabled} value={value == null ? "" : Number((value / factor).toFixed(2))} onChange={(e) => onChange({ [key]: e.target.value === "" ? (["regularMinutes", "overtimeMinutes", "salaryCents"].includes(key) ? null : 0) : Math.round(Number(e.target.value) * factor) })} /></label>;
  };
  return <article className={panelClass}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{row.name}</h3><p className="text-sm text-muted-foreground">{enumLabel(row.role)} · Raw worked: {hours(row.workedMinutes)} · Recorded meals: {hours(row.mealMinutes)}</p></div><p className="text-sm">Saved paid total: <strong>{hours(row.paidMinutes)}</strong></p></div>
    <fieldset disabled={!editable} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-sm"><span>Payroll employee ID</span><input className={fieldClass} value={input.payrollId} onChange={(e) => onChange({ payrollId: e.target.value })} /></label>
      <label className="space-y-1 text-sm"><span>Pay basis</span><select className={fieldClass} value={input.payBasis ?? ""} onChange={(e) => onChange({ payBasis: e.target.value === "" ? null : e.target.value as PacketInput["payBasis"] })}><option value="">Choose…</option><option value="hourly">Hourly</option><option value="salary">Salary</option></select></label>
      <label className="space-y-1 text-sm"><span>Group</span><select className={fieldClass} value={input.department} onChange={(e) => onChange({ department: e.target.value as PacketInput["department"] })}><option value="administration">Administration</option><option value="operations">Operations</option></select></label>
      {numeric("Regular", "regularMinutes", "hours", policy?.calculationMode !== "reviewed")}
      {numeric("Overtime", "overtimeMinutes", "hours", policy?.calculationMode !== "reviewed")}
      {numeric("Holiday", "holidayMinutes", "hours")}{numeric("Personal", "personalMinutes", "hours")}{numeric("Training", "trainingMinutes", "hours")}{numeric("On call", "onCallCents", "dollars")}{numeric("Bonus", "bonusCents", "dollars")}
      {input.payBasis === "salary" && policy?.salaryTreatment === "amount" && numeric("Salary", "salaryCents", "dollars")}
      {input.payBasis === "salary" && policy?.salaryTreatment === "unchanged" && <p className="self-center text-sm">Salary — unchanged</p>}
      <label className="space-y-1 text-sm sm:col-span-2"><span>Payroll notes</span><textarea className={fieldClass} rows={2} value={input.note} onChange={(e) => onChange({ note: e.target.value })} /></label>
      <label className="space-y-1 text-sm sm:col-span-2"><span>{policy?.calculationMode === "reviewed" ? "Hours allocation reason (required)" : "Adjustment reason"}</span><textarea className={fieldClass} rows={2} value={input.reason} onChange={(e) => onChange({ reason: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4"><input type="checkbox" checked={input.reviewed} onChange={(e) => onChange({ reviewed: e.target.checked })} />I reviewed this employee’s hours, pay basis and amounts.</label>
    </fieldset>
    {row.issues.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive">{row.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
  </article>;
}
