"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";

export type ReturnFollowup = {
  id: string;
  status: "pending" | "completed";
  created_at: string;
  result_code: string | null;
};
type FormChoice = { id: string; physician_name: string | null; exam_date: string | null; status: string; updated_at: string };
type FollowupResult = { status: string; outcome: string; code?: string };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function pendingMessage(code: string | null) {
  if (code === "document_update_failed") return "The document update failed. Presence is saved and this follow-up remains open for retry.";
  if (code === "return_episode_changed") return "The resident's presence or return episode changed. Review this follow-up before closing it.";
  if (code === "newer_document_present") return "A newer physician report is available. Review that report before closing this follow-up.";
  if (code === "no_eligible_forms") return "No eligible Form 1823 was available at return. Review the resident's current physician report.";
  if (code?.includes("changed") || code?.includes("missing")) return "Document evidence changed after return. Review the current report before closing this follow-up.";
  return "Presence is saved. The return document follow-up is still open.";
}

export function ResidentReturnFollowups({ residentId, refreshKey }: { residentId: string; refreshKey?: string | null }) {
  const { user, appRole, loading } = useHavenAuth();
  const visible = ["owner", "org_admin", "facility_admin", "nurse", "caregiver"].includes(appRole);
  if (loading || !user || !visible) return null;
  return <FollowupsForResident key={`${residentId}:${user.id}:${appRole}`} residentId={residentId} refreshKey={refreshKey} canReview={appRole !== "caregiver"} />;
}

function FollowupsForResident({ residentId, refreshKey, canReview }: { residentId: string; refreshKey?: string | null; canReview: boolean }) {
  const [rows, setRows] = useState<ReturnFollowup[]>([]);
  const [legacyTime, setLegacyTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    void (async () => {
      try {
        const all: ReturnFollowup[] = [];
        for (let offset = 0; ; ) {
          const { data, error: queryError } = await supabase.from("resident_return_followups" as never)
            .select("id,status,created_at,result_code").eq("resident_id", residentId).eq("status", "pending")
            .order("id", { ascending: true }).range(offset, offset + 199);
          if (queryError) throw queryError;
          const page = (data ?? []) as unknown as ReturnFollowup[];
          if (!page.length) break;
          all.push(...page);
          offset += page.length;
        }
        const { data, error: residentError } = await supabase.from("residents")
          .select("hold_case_manager_notified_at").eq("id", residentId).is("deleted_at", null).maybeSingle();
        if (residentError) throw residentError;
        if (!cancelled) { setRows(all); setLegacyTime(data?.hold_case_manager_notified_at ?? null); }
      } catch {
        if (!cancelled) { setRows([]); setLegacyTime(null); setError("Return follow-up could not be loaded. Refresh to check for unresolved work."); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [residentId, refreshKey, revision]);

  if (!loading && !error && !rows.length && !legacyTime) return null;
  return <section aria-label="Return follow-up" className="rounded-lg border border-border bg-card p-4 text-sm">
    <h2 className="font-semibold">Return follow-up</h2>
    {loading && <p role="status" className="mt-2 text-muted-foreground">Checking unresolved return work…</p>}
    {error && <div className="mt-2"><p role="alert">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Refresh follow-up</Button></div>}
    {!loading && !error && rows.map((row) => <ReturnFollowupAction key={row.id} row={row} residentId={residentId} canReview={canReview} onSaved={() => setRevision((value) => value + 1)} />)}
    {!loading && legacyTime && <p className="mt-3 text-xs text-muted-foreground">Previously recorded notification time: {dateLabel(legacyTime)}. Supporting communication evidence is unavailable.</p>}
  </section>;
}

function ReturnFollowupAction({ row, residentId, canReview, onSaved }: { row: ReturnFollowup; residentId: string; canReview: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [forms, setForms] = useState<FormChoice[]>([]);
  const [formId, setFormId] = useState("");
  const [note, setNote] = useState("");

  async function retry() {
    setBusy(true); setMessage(null);
    try {
      const { data, error } = await createClient().rpc("haven_retry_return_document_followup" as never, { p_followup_id: row.id } as never);
      if (error) throw error;
      const result = data as unknown as FollowupResult;
      if (result?.status === "completed") onSaved();
      else setMessage(pendingMessage(result?.code ?? row.result_code));
    } catch { setMessage("Document update was not confirmed. This follow-up remains open; refresh or retry when access and connection are restored."); }
    finally { setBusy(false); }
  }

  async function openReview() {
    setBusy(true); setMessage(null);
    try {
      const all: FormChoice[] = [];
      const supabase = createClient();
      for (let offset = 0; ; ) {
        const { data, error } = await supabase.from("form_1823_records" as never)
          .select("id,physician_name,exam_date,status,updated_at").eq("resident_id", residentId).is("deleted_at", null)
          .gte("updated_at", row.created_at).order("id", { ascending: true }).range(offset, offset + 199);
        if (error) throw error;
        const page = (data ?? []) as unknown as FormChoice[];
        if (!page.length) break;
        all.push(...page); offset += page.length;
      }
      setForms(all); setFormId(""); setReviewing(true);
    } catch { setMessage("Current physician reports could not be loaded. The follow-up remains open."); }
    finally { setBusy(false); }
  }

  async function resolve() {
    if (!formId || !note.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const { data, error } = await createClient().rpc("haven_resolve_return_document_followup" as never, {
        p_followup_id: row.id, p_form_id: formId, p_review_note: note.trim(),
        p_form_updated_at: forms.find((form) => form.id === formId)?.updated_at,
      } as never);
      if (error) throw error;
      if ((data as unknown as FollowupResult)?.status !== "completed") throw new Error("Review not confirmed");
      onSaved();
    } catch { setMessage("Review was not confirmed. Your note remains here; refresh the report evidence before trying again."); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 space-y-2 border-t border-border pt-3">
    <p className="font-medium">Hospital return · {dateLabel(row.created_at)}</p>
    <p className="text-muted-foreground">{pendingMessage(row.result_code)}</p>
    {message && <p role="status">{message}</p>}
    {canReview ? <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry()}>Retry document update</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openReview()}>Record separate review</Button>
    </div> : <p className="text-muted-foreground">A nurse or administrator can review the document follow-up.</p>}
    {reviewing && <div className="space-y-3 rounded-md bg-muted/40 p-3">
      <p>Record a review you have completed. This closes the follow-up without changing the physician report or admission clearance.</p>
      {!forms.length ? <p>No physician report has been updated since this return. Update the report in the resident’s admission documents, then reopen this review.</p> : <>
        <label className="block space-y-1"><span className="font-medium">Reviewed physician report</span><select value={formId} onChange={(event) => setFormId(event.target.value)} disabled={busy} className="w-full rounded-md border border-input bg-background p-2">
          <option value="">Choose the report you reviewed</option>
          {forms.map((form, index) => <option key={form.id} value={form.id}>Report {index + 1} · {form.physician_name || "Physician not recorded"} · {form.exam_date ? `Exam ${form.exam_date}` : "Exam date not recorded"}</option>)}
        </select></label>
        {forms.filter((form) => form.id === formId).map((form) => <p key={form.id} className="break-words text-xs text-muted-foreground">{form.physician_name || "Physician not recorded"} · {form.status.replace(/_/g, " ")} · updated {dateLabel(form.updated_at)}. Report reference: {form.id}</p>)}
        <label className="block space-y-1"><span className="font-medium">Review evidence</span><textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} maxLength={4000} rows={3} className="w-full rounded-md border border-input bg-background p-2" /></label>
        <Button size="sm" disabled={busy || !formId || !note.trim()} onClick={() => void resolve()}>Record completed review</Button>
      </>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReviewing(false)}>Close review form</Button>
    </div>}
  </div>;
}
