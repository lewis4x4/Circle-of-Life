"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { todayFacilityDateIso, facilityDatetimeLocalToUtcIso } from "@/lib/facility-wall-clock";
import { assessEmployeeFile, assessDutyReadiness, employeeAuditExport, DUTIES, displayDuty, FILE_CATEGORIES, SIGNER_PURPOSES, type EmployeeFileData, type EmployeeRequirement, type EmployeeFileRecord } from "@/lib/staff/employee-file";
import { assessAttendanceReview } from "@/lib/staff/attendance-review";
import { NEW_STAFF_ROLES } from "@/types/staff";
import { EmployeeMedicalReviewers } from "./EmployeeMedicalReviewers";
import { EmployeeTrainingEvidence } from "./EmployeeTrainingEvidence";
import { useEmployeeResource } from "@/lib/staff/use-employee-resource";

type SourceTemplate = Pick<EmployeeRequirement, "code" | "title" | "category" | "source_file" | "source_page" | "source_excerpt" | "content" | "required_signers" | "recurrence_status" | "recurrence_months" | "due_days" | "duty">;

const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
function formatFacilityDateIso(date: Date) { return todayFacilityDateIso(date); }
type RunCommand = (action: string, payload: Record<string, unknown>, requirement?: boolean) => Promise<unknown>;
function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function numberOrNull(form: FormData, key: string) { const value = text(form, key); return value ? Number(value) : null; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-4 rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>; }

export default function EmployeeFileClient({ staffId, selfService = false }: { staffId: string; selfService?: boolean }) {
  const [data, setData] = useState<EmployeeFileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("file");
  const endpoint = `/api/admin/staff/${staffId}/employee-file`;
  const load = useCallback(async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load employee file.");
      setData(body);
    } catch (e) { setData(null); setError(e instanceof Error ? e.message : "Could not load employee file."); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const run: RunCommand = async (action, payload, requirement = false) => {
    const response = await fetch(`${endpoint}${requirement ? "/requirements" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save change.");
    return body.result;
  };
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await operation(); await load(); setNotice("Saved."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save change."); }
    finally { setBusy(false); }
  };
  if (!data) return <div className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Employee file</h1>{loading ? <p role="status">Loading employee file…</p> : <><p role="alert">{error}</p><Button onClick={() => void load()}>Retry</Button></>}</div>;
  const today = todayFacilityDateIso();
  const assessments = assessEmployeeFile(data.requirements, data.records, data.staff, today);
  const visibleAssessments = assessments.filter((a) => a.requirement.category !== "medical" || data.canMedical);
  const activeRequirements = assessments.map((a) => a.requirement);
  const accessibleRequirements = activeRequirements.filter((r) => r.category !== "medical" || data.canMedical);
  return <main className="space-y-6 p-4 md:p-6">
    <header className="space-y-2"><Link href={selfService ? "/" : `/admin/staff/${staffId}`} className="text-sm underline">{selfService ? "Home" : "Employee profile"}</Link><h1 className="text-2xl font-semibold">{data.staff.first_name} {data.staff.last_name} · Employee file</h1><p className="text-sm text-muted-foreground">{data.staff.facility_name ? `${data.staff.facility_name} · ` : ""}Documents, onboarding evidence, and duty readiness in one place.</p></header>
    {selfService && <Link className="inline-block text-sm underline" href="/employee-file/reviews">Assigned medical-file reviews</Link>}
    {error && <p role="alert" className="rounded-md border border-destructive p-3">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <nav aria-label="Employee file sections" className="flex flex-wrap gap-2">
      {[["file", "Documents & onboarding"], ["readiness", "Duty readiness"], ...(data.canManage ? [["attendance", "Attendance review"], ["requirements", "Requirements"]] : [])].map(([id, title]) => <Button key={id} variant={tab === id ? "default" : "outline"} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</Button>)}
    </nav>
    {tab === "file" && <>
      <Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await run("record_export", {}); const blob = new Blob([JSON.stringify(employeeAuditExport(data, today), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `employee-checklist-${data.staff.id}-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>Download personnel checklist</Button>
      {!activeRequirements.length && <Panel title="Set up the employee checklist"><p>No applicable requirements have been approved for this employee yet.</p>{data.canManage && <Button onClick={() => setTab("requirements")}>Review packet templates</Button>}</Panel>}
      <Panel title="Checklist">
        {!data.canMedical && <p className="text-sm text-muted-foreground">Confidential medical documents are available only to the employee and designated medical-file reviewers.</p>}
        <ul className="divide-y">{visibleAssessments.map(({ requirement, state, dueOn, overdue, completedCount, completedDays, requiredCount, requiredDays }) => <li key={requirement.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{requirement.title}</p><p className="text-sm text-muted-foreground">Version {requirement.version} · {displayDuty(requirement.category)}{dueOn && ` · Due ${dueOn}`} · {completedCount}/{requiredCount ?? "?"} completions on {completedDays}/{requiredDays ?? "?"} days</p></div><Badge className="text-foreground" variant={overdue || state === "expired" ? "destructive" : "outline"}>{overdue ? "Overdue · " : ""}{displayDuty(state)}</Badge></li>)}</ul>
      </Panel>
      {!!accessibleRequirements.length && (data.canManage || data.actorId === data.staff.user_id) && <RecordSubmission requirements={accessibleRequirements} run={run} perform={perform} busy={busy} />}
      <EmployeeTrainingEvidence staffId={data.staff.id} canManage={data.canManage} />
      <Panel title="Submitted documents and signatures">
        {!data.records.length && <p className="text-sm text-muted-foreground">No documents submitted yet.</p>}
        {data.records.filter((record) => data.canMedical || data.requirements.find((r) => r.id === record.requirement_id)?.category !== "medical").map((record) => <RecordCard key={record.id} record={record} data={data} endpoint={endpoint} busy={busy} perform={perform} run={run} />)}
      </Panel>
    </>}
    {tab === "readiness" && <>
      <Panel title="Readiness for assigned duties"><p className="text-sm text-muted-foreground">Based on approved requirements and verified evidence. Missing or unresolved requirements do not grant clearance.</p><div className="grid gap-4 md:grid-cols-3">{DUTIES.map((duty) => { const result = assessDutyReadiness(assessments, duty, data.staff.employment_status, data.staff.hire_date, today); return <article key={duty} className="space-y-2 rounded-md border p-4"><h3 className="font-medium">{displayDuty(duty)}</h3><Badge className="text-foreground" variant={result.status === "blocked" ? "destructive" : "outline"}>{displayDuty(result.status)}</Badge><ul className="space-y-1 text-sm">{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></article>; })}</div></Panel>
      <Panel title="Actual duty history"><p className="text-sm text-muted-foreground">Record what happened, including activity before clearance. Recording an event does not grant permission.</p><ul className="space-y-2">{data.dutyEvents.map((event) => <li key={event.id}>{displayDuty(event.duty)} · {new Date(event.occurred_at).toLocaleString("en-US", { timeZone: "America/New_York" })}{event.readiness_snapshot?.requires_review && <Badge className="ml-2 text-foreground" variant="destructive">Clearance needs review</Badge>}{event.readiness_snapshot && <p className="text-xs text-muted-foreground">Assessed when recorded: {displayDuty(event.readiness_snapshot.status)}. This does not reconstruct historical policy.</p>}</li>)}</ul>
        {data.canManage && <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("record_duty", { duty: text(f,"duty"), occurred_at: facilityDatetimeLocalToUtcIso(text(f,"occurred_at")), evidence_note: text(f,"note") }); }); }}><Field label="Duty"><select name="duty" className={fieldClass}>{DUTIES.map((d) => <option key={d} value={d}>{displayDuty(d)}</option>)}</select></Field><Field label="Actual date and time (Eastern time)"><Input name="occurred_at" type="datetime-local" required /></Field><Field label="How this activity was confirmed"><Input name="note" required /></Field><Button disabled={busy} type="submit">Record actual activity</Button></form>}
      </Panel>
    </>}
    {tab === "requirements" && data.canManage && <RequirementManager data={data} run={run} perform={perform} busy={busy} />}
    {tab === "attendance" && data.canManage && <AttendanceReview data={data} run={run} perform={perform} busy={busy} today={today} />}
  </main>;
}

type ActionProps = { run: RunCommand; perform: (operation: () => Promise<void>) => Promise<void>; busy: boolean };
function RecordSubmission({ requirements, run, perform, busy }: ActionProps & { requirements: EmployeeRequirement[] }) {
  return <Panel title="Submit evidence"><form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); const file = f.get("file") as File;
    const requirement = requirements.find((r) => r.id === text(f,"requirement_id"));
    void perform(async () => {
      if (file?.size > 10 * 1024 * 1024) throw new Error("Use a file smaller than 10 MB.");
      if (file?.size && !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Use a PDF, PNG, or JPEG file.");
      const id = crypto.randomUUID();
      await run("submit_record", { id, requirement_id: text(f,"requirement_id"), completed_on: text(f,"completed_on") || null, expires_on: text(f,"expires_on") || null, notes: text(f,"notes"), evidence_reference: text(f,"evidence_reference") || null });
      if (file?.size) {
        const path = `${id}/${crypto.randomUUID()}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`;
        const result = await createClient().storage.from(requirement?.category === "medical" ? "employee-medical" : "employee-personnel").upload(path, file, { upsert: false, contentType: file.type });
        if (result.error) throw new Error("The submission was saved, but the file upload failed. It remains unverified. Submit a replacement with the attachment.");
        await run("attach_record", { id, storage_path: path });
      }
    });
  }}>
    <Field label="Requirement"><select name="requirement_id" className={fieldClass}>{requirements.map((r) => <option key={r.id} value={r.id}>{r.title} · v{r.version}</option>)}</select></Field>
    <Field label="Completion date"><Input name="completed_on" type="date" required /></Field>
    <Field label="Evidence expiration date, if established"><Input name="expires_on" type="date" /></Field>
    <Field label="Attachment (PDF, PNG or JPEG; up to 10 MB)"><Input name="file" type="file" accept="application/pdf,image/png,image/jpeg" /></Field>
    <Field label="Signed paper or external record reference, if applicable"><Input name="evidence_reference" /></Field>
    <Field label="Notes"><Input name="notes" /></Field><Button type="submit" disabled={busy}>Submit for review</Button>
  </form></Panel>;
}

function RecordCard({ record, data, endpoint, run, perform, busy }: ActionProps & { record: EmployeeFileRecord; data: EmployeeFileData; endpoint: string }) {
  const requirement = data.requirements.find((r) => r.id === record.requirement_id);
  if (!requirement) return null;
  const signatures = data.signatures.filter((s) => s.record_id === record.id);
  const isSelf = data.actorId === data.staff.user_id;
  const availablePurposes = requirement.required_signers.filter((purpose) => {
    if (signatures.some((s) => s.functional_role === purpose || s.user_id === data.actorId)) return false;
    if (purpose === "employee") return isSelf;
    if (purpose === "provider" || isSelf) return false;
    if (purpose === "supervisor" || purpose === "administrator") return data.canManage;
    if (purpose === "trainer") return data.canManage || data.actorRole === "nurse";
    return data.canManage || data.actorRole === "nurse" || data.actorRole === "coordinator";
  });
  const canReview = requirement.category === "medical" ? data.canMedical && data.staff.user_id !== data.actorId : data.canManage && data.actorId !== data.staff.user_id;
  return <article className="space-y-3 rounded-md border p-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{requirement.title} · v{requirement.version}</h3><Badge variant="outline">{displayDuty(record.status)}</Badge></div>
    <p className="text-sm">Completed {record.completed_on ?? "not recorded"}{record.expires_on && ` · Expires ${record.expires_on}`}</p>
    {record.evidence_reference && <p className="text-sm">Evidence reference: {record.evidence_reference}</p>}{record.notes && <p className="text-sm">{record.notes}</p>}
    <details><summary className="cursor-pointer text-sm underline">Read the approved requirement and source</summary><p className="mt-2 whitespace-pre-wrap text-sm">{requirement.content}</p><p className="mt-2 text-xs text-muted-foreground">{requirement.source_file}, page {requirement.source_page} · {requirement.source_excerpt}</p></details>
    {record.storage_path && <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(async () => { const response = await fetch(`${endpoint}/download?record_id=${record.id}`); const result = await response.json(); if (!response.ok) throw new Error(result.error); window.open(result.url, "_blank", "noopener,noreferrer"); })}>Download evidence</Button>}
    <ul className="text-sm">{signatures.map((s) => <li key={s.id}>{displayDuty(s.functional_role)}: {s.signature_name} · {new Date(s.signed_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}</li>)}</ul>
    {record.status === "submitted" && <>
      {!!availablePurposes.length && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("sign_record", { id: record.id, functional_role: text(f,"functional_role"), signature_name: text(f,"signature_name") }); }); }}>
        <Field label="Signing capacity"><select name="functional_role" className={fieldClass}>{availablePurposes.map((purpose) => <option value={purpose} key={purpose}>{displayDuty(purpose)}</option>)}</select></Field><Field label="Your full name"><Input name="signature_name" required minLength={3} /></Field><label className="flex max-w-sm items-center gap-2 text-sm"><input type="checkbox" required />I reviewed the requirement and evidence and am signing in my own capacity.</label><Button disabled={busy} type="submit">Sign</Button>
      </form>}
      {canReview && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("review_record", { id: record.id, status: text(f,"status"), review_note: text(f,"review_note") }); }); }}><Field label="Review decision"><select name="status" className={fieldClass}><option value="verified">Verify evidence</option><option value="rejected">Reject evidence</option></select></Field><Field label="Review findings, including paper signatures checked"><Input name="review_note" required /></Field><Button disabled={busy} type="submit">Save review</Button></form>}
    </>}
  </article>;
}

function RequirementManager(props: ActionProps & { data: EmployeeFileData }) {
  const [revision, setRevision] = useState(0);
  const { data: templates, error } = useEmployeeResource<SourceTemplate[]>(`/api/admin/staff/${props.data.staff.id}/employee-file/catalog`, revision);
  if (error) return <Panel title="Packet source catalog"><p role="alert">{error}</p><Button onClick={() => setRevision((value) => value + 1)}>Retry catalog</Button></Panel>;
  if (!templates) return <Panel title="Packet source catalog"><p role="status">Loading packet sources…</p></Panel>;
  if (!templates.length) return <Panel title="Packet source catalog"><p>No packet sources are available.</p></Panel>;
  return <LoadedRequirementManager {...props} packetTemplates={templates} />;
}

function LoadedRequirementManager({ data, run, perform, busy, packetTemplates }: ActionProps & { data: EmployeeFileData; packetTemplates: SourceTemplate[] }) {
  const [selected, setSelected] = useState(packetTemplates[0].code);
  const template = packetTemplates.find((t) => t.code === selected)!;
  const nextVersion = Math.max(0, ...data.requirements.filter((r) => r.code === selected).map((r) => r.version)) + 1;
  const staffRoles = [...new Set(["cna", "lpn", "rn", "administrator", "activities_director", "dietary_staff", "dietary_manager", "maintenance", "housekeeping", "driver", "other", ...NEW_STAFF_ROLES, data.staff.staff_role])];
  return <>
    <Panel title="Create a requirement version"><p className="text-sm text-muted-foreground">Packet entries are source material. Confirm full content, applicable duties, and timing before approval. Adding a draft does not assign work or grant clearance.</p>
      <Field label="Packet source"><select value={selected} onChange={(e) => setSelected(e.target.value)} className={fieldClass}>{packetTemplates.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.title}</option>)}</select></Field>
      <form key={`${selected}-${nextVersion}`} className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("create", { ...template, version: Number(text(f,"version")), title: text(f,"title"), category: text(f,"category"), content: text(f,"content"), required_signers: f.getAll("signers"), applies_to_staff_roles: f.getAll("roles"), applicability_note: text(f,"applicability_note"), minimum_completions: numberOrNull(f,"minimum_completions"), minimum_distinct_days: numberOrNull(f,"minimum_distinct_days"), due_days: numberOrNull(f,"due_days"), recurrence_status: text(f,"recurrence_status"), recurrence_months: numberOrNull(f,"recurrence_months"), duty: text(f,"duty") || null }, true); }); }}>
        <Field label="Title"><Input name="title" defaultValue={template.title} required /></Field><Field label="Version"><Input name="version" type="number" min={1} defaultValue={nextVersion} required /></Field>
        <Field label="Record category"><select name="category" defaultValue={template.category} className={fieldClass}>{FILE_CATEGORIES.map((c) => <option key={c} value={c}>{displayDuty(c)}</option>)}</select></Field>
        <Field label="Applicable staff roles"><select aria-label="Applicable staff roles" name="roles" multiple defaultValue={[]} className={fieldClass} aria-describedby="applicability-help"><option value="*">All staff roles (explicit approval)</option>{staffRoles.map((role) => <option key={role} value={role}>{displayDuty(role)}</option>)}</select><span id="applicability-help" className="text-xs font-normal text-muted-foreground">Select every applicable role. Leave unselected while applicability is unresolved.</span></Field>
        <Field label="Applicability decision and source"><Input name="applicability_note" /></Field>
        <Field label="Required completions or sessions (blank if unresolved)"><Input name="minimum_completions" type="number" min={1} defaultValue={template.code === "ORI-30" ? "" : 1} /></Field><Field label="Required distinct training days (blank if unresolved)"><Input name="minimum_distinct_days" type="number" min={1} defaultValue={template.code === "ORI-30" ? "" : 1} /></Field>
        <Field label="Due days after hire, only if established"><Input name="due_days" type="number" min={0} /></Field>
        <Field label="Recurrence"><select name="recurrence_status" defaultValue={template.recurrence_status} className={fieldClass}><option value="unknown">Needs review</option><option value="one_time">One time</option><option value="recurring">Recurring</option></select></Field><Field label="Renewal interval in months, only if recurring"><Input name="recurrence_months" type="number" min={1} defaultValue={template.recurrence_months ?? ""} /></Field>
        <Field label="Duty this requirement controls"><select name="duty" defaultValue={template.duty ?? ""} className={fieldClass}><option value="">No duty restriction</option>{DUTIES.map((d) => <option key={d} value={d}>{displayDuty(d)}</option>)}</select></Field>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Required signing capacities</legend><div className="flex flex-wrap gap-3">{SIGNER_PURPOSES.map((p) => <label key={p} className="flex items-center gap-1 text-sm"><input type="checkbox" name="signers" value={p} defaultChecked={(template.required_signers as string[]).includes(p)} />{displayDuty(p)}</label>)}</div></fieldset>
        <label className="grid gap-1.5 text-sm font-medium md:col-span-2">Complete requirement text to approve<textarea name="content" rows={6} defaultValue={template.content} required className={fieldClass} /></label><p className="text-sm text-muted-foreground md:col-span-2">Source: {template.source_file}, page {template.source_page}. {template.source_excerpt}</p><Button disabled={busy} type="submit">Save draft version</Button>
      </form>
    </Panel>
    <Panel title="Review requirement versions"><ul className="space-y-4">{data.requirements.map((r) => <li key={r.id} className="space-y-2 border-b pb-4"><p className="font-medium">{r.title} · v{r.version} <Badge variant="outline">{r.review_status}</Badge></p><p className="text-sm">Roles: {r.applies_to_staff_roles.join(", ") || "Needs review"} · Recurrence: {r.recurrence_status}</p><details><summary className="cursor-pointer text-sm underline">Review full content</summary><p className="whitespace-pre-wrap text-sm">{r.content}</p></details>{r.review_status !== "retired" && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run(r.review_status === "draft" ? "approve" : "retire", { id: r.id, review_note: text(f,"note") }, true); }); }}><Field label="Approval or retirement rationale"><Input name="note" required /></Field><label className="flex max-w-sm items-center gap-2 text-sm"><input type="checkbox" required />I verified the complete text, applicability, and timing against the approved source.</label><Button disabled={busy} variant="outline" type="submit">{r.review_status === "draft" ? "Approve version" : "Retire version"}</Button></form>}</li>)}</ul></Panel>
    {["owner", "org_admin"].includes(data.actorRole ?? "") && <EmployeeMedicalReviewers staffId={data.staff.id} onChange={async () => { await perform(async () => {}); }} />}
  </>;
}

function AttendanceReview({ data, run, perform, busy, today }: ActionProps & { data: EmployeeFileData; today: string }) {
  if (data.staff.hire_date > today) return <Panel title="Attendance review"><p>Employment starts on {data.staff.hire_date}. Attendance review becomes available on that date.</p></Panel>;
  const assessment = assessAttendanceReview({ asOf: today, employmentStartDate: data.staff.hire_date, occurrences: data.attendance.map((event) => ({ id: event.id, date: formatFacilityDateIso(new Date(event.occurred_at)), kind: event.event_type === "no_show" ? "no_call_no_show" as const : event.event_type === "left_early" ? "left_early" as const : event.event_type === "attendance_note" ? "tardy" as const : "absence" as const, minutesLate: event.minutes_deviation ?? undefined, minutesEarly: event.minutes_deviation ?? undefined, review: event.review_status, reviewReason: event.review_reason ?? undefined })) });
  return <>
    <Panel title="Attendance review"><p className="text-sm text-muted-foreground">Thresholds below are draft interpretations of the 2021 packet. They propose review; they do not issue discipline, reset history, or end employment.</p><p>{assessment.countedAbsences} reviewed absences · {assessment.countedTardies} reviewed late/early events · {assessment.pendingReviewIds.length} awaiting review</p><ul className="space-y-2 text-sm">{assessment.candidateNotices.map((n, i) => <li key={i}>{n.message}</li>)}</ul><p className="text-sm">Good-citizen review: {assessment.cleanPeriodCredit.candidate ? "Candidate for review" : "Not yet established"}. Credits require a documented request, meeting, and authorized approval.</p></Panel>
    <Panel title="Record attendance event"><form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("record_attendance", { event_type: text(f,"event_type"), occurred_at: facilityDatetimeLocalToUtcIso(text(f,"occurred_at")), reason: text(f,"reason"), minutes_deviation: numberOrNull(f,"minutes_deviation"), notification_method: text(f,"notification_method"), notification_minutes_before: numberOrNull(f,"notification_minutes_before") }); }); }}>
      <Field label="Event"><select name="event_type" className={fieldClass}><option value="callout">Absence</option><option value="late_callout">Absence with late notification</option><option value="no_show">No call / no show</option><option value="left_early">Left early</option><option value="attendance_note">Late arrival</option></select></Field><Field label="Event date and time (Eastern time)"><Input name="occurred_at" type="datetime-local" required /></Field><Field label="Minutes late or early, when applicable"><Input name="minutes_deviation" type="number" min={0} /></Field><Field label="Notification method"><Input name="notification_method" /></Field><Field label="Minutes notice before shift"><Input name="notification_minutes_before" type="number" /></Field><Field label="Operational note (exclude diagnoses or medical details)"><Input name="reason" required /></Field><Button disabled={busy} type="submit">Record for review</Button>
    </form></Panel>
    <Panel title="Review recorded events"><ul className="space-y-4">{data.attendance.map((event) => <li key={event.id} className="space-y-2 border-b pb-4"><p>{displayDuty(event.event_type)} · {formatFacilityDateIso(new Date(event.occurred_at))} · {event.review_status}</p><p className="text-sm">{event.reason}</p>{event.review_status === "pending" && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("review_attendance", { id: event.id, review_status: text(f,"review_status"), review_reason: text(f,"reason") }); }); }}><Field label="Event decision"><select name="review_status" className={fieldClass}><option value="excluded">Exclude from attendance counts</option><option value="counted">Count after review</option></select></Field><Field label="Reason for the decision"><Input name="reason" required /></Field><Button disabled={busy} type="submit">Save event review</Button></form>}</li>)}</ul></Panel>
    <Panel title="Record a human corrective-action decision"><p className="text-sm text-muted-foreground">Record only a decision already reviewed and authorized. This records history; it does not change employment status.</p><form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("record_corrective_action", { action: text(f,"action"), attendance_event_id: text(f,"event_id"), notes: text(f,"notes"), effective_date: text(f,"date"), absence_count_at_action: assessment.countedAbsences, tardy_count_at_action: assessment.countedTardies, copy_given_to_employee_at: text(f,"copy_at") ? facilityDatetimeLocalToUtcIso(text(f,"copy_at")) : null }); }); }}><Field label="Reviewed triggering event"><select name="event_id" required className={fieldClass}><option value="">Select a reviewed event</option>{data.attendance.filter((e) => e.review_status === "counted").map((e) => <option key={e.id} value={e.id}>{displayDuty(e.event_type)} · {formatFacilityDateIso(new Date(e.occurred_at))}</option>)}</select></Field><Field label="Authorized decision"><select name="action" className={fieldClass}>{["verbal_warning", "written_warning", "final_written_warning", "termination"].map((a) => <option key={a} value={a}>{displayDuty(a)}</option>)}</select></Field><Field label="Effective date"><Input type="date" name="date" required /></Field><Field label="Copy given to employee (Eastern time)"><Input type="datetime-local" name="copy_at" /></Field><Field label="Decision rationale and coaching document reference"><Input name="notes" required /></Field><Button disabled={busy} type="submit">Record authorized decision</Button></form></Panel>
    <Panel title="Corrective-action history"><ul className="space-y-4">{data.correctiveActions.map((action) => <li key={action.id} className="space-y-2"><p>{displayDuty(action.action)} · {action.effective_date} {action.retracted_at ? "· Retracted" : ""}</p><p className="text-sm">{action.notes}</p>{!action.retracted_at && <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void perform(async () => { await run("retract_corrective_action", { id: action.id, retraction_reason: text(f,"reason"), employee_requested_at: facilityDatetimeLocalToUtcIso(text(f,"requested_at")), review_meeting_at: facilityDatetimeLocalToUtcIso(text(f,"meeting_at")) }); }); }}><Field label="Employee request (Eastern time)"><Input name="requested_at" type="datetime-local" required /></Field><Field label="Review meeting (Eastern time)"><Input name="meeting_at" type="datetime-local" required /></Field><Field label="Retraction rationale"><Input name="reason" required /></Field><Button variant="outline" disabled={busy} type="submit">Approve retraction and retain history</Button></form>}</li>)}</ul></Panel>
  </>;
}
