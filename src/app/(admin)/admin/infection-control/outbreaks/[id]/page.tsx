"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatOutbreakDetailStatusLine } from "@/lib/infection-control/outbreak-detail-display-copy";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

export default function OutbreakDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  const [actions, setActions] = useState<Record<string, unknown>[]>([]);
  const [outbreakNotes, setOutbreakNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [o, a] = await Promise.all([
      supabase.from("infection_outbreaks").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("outbreak_actions")
        .select("*")
        .eq("outbreak_id", id)
        .is("deleted_at", null)
        .order("sort_order"),
    ]);
    if (o.error) {
      setError(o.error.message);
      return;
    }
    setOut(o.data as Record<string, unknown>);
    if (a.error) setError(a.error.message);
    else setActions((a.data ?? []) as Record<string, unknown>[]);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function completeAction(actionId: string) {
    if (busy || !notes[actionId]?.trim()) return;
    setBusy(actionId); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in again.");
      const result = await supabase.from("outbreak_actions").update({ status: "completed", completed_by: user.id, completed_at: new Date().toISOString(), completion_notes: notes[actionId], updated_by: user.id }).eq("id", actionId).in("status", ["pending", "in_progress"]).select("id").single();
      if (result.error) throw result.error;
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Action was not saved"); } finally { setBusy(null); }
  }

  async function takeOwnership(actionId: string) {
    setBusy(actionId); setError(null);
    try { const { data: { user } } = await supabase.auth.getUser(); if (!user) throw new Error("Sign in again."); const result = await supabase.from("outbreak_actions").update({ assigned_to: user.id, status: "in_progress", updated_by: user.id }).eq("id", actionId).is("assigned_to", null).select("id").single(); if (result.error) throw result.error; await load(); } catch (e) { setError(e instanceof Error ? e.message : "Assignment not saved"); } finally { setBusy(null); }
  }
  async function updateOutbreak(status: "contained" | "resolved") {
    setBusy(id); setError(null);
    try { const result = await supabase.rpc("close_outbreak_review" as never, { p_id: id, p_status: status, p_notes: outbreakNotes } as never); if (result.error) throw result.error; await load(); } catch (e) { setError(e instanceof Error ? e.message : "Outbreak status not saved"); } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <RecordDetailHeader
        title={out ? String(out.infection_type) : "Outbreak"}
        subtitle={
          out
            ? formatOutbreakDetailStatusLine(out.status, out.total_cases as number | null | undefined)
            : undefined
        }
        backLink={{ label: "Infection control", href: "/admin/infection-control" }}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {out && out.status !== "resolved" && <RecordDetailSection title="Outbreak review"><label>Clinical status evidence<textarea value={outbreakNotes} onChange={(e) => setOutbreakNotes(e.target.value)} className="block w-full rounded border p-2" /></label><button disabled={!!busy || !outbreakNotes.trim()} onClick={() => void updateOutbreak("contained")}>Record containment</button><button disabled={!!busy || !outbreakNotes.trim()} onClick={() => void updateOutbreak("resolved")}>Resolve outbreak after case and action review</button></RecordDetailSection>}
      <RecordDetailSection title="Action checklist">
        <div className="text-sm">
          {actions.length === 0 ? (
            <p className="text-muted-foreground">No actions loaded.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1">
              {actions.map((x) => (
                <li key={String(x.id)}>
                  {String(x.title)} —{" "}
                  <span className="text-muted-foreground">{String(x.status)}</span>
                  {!x.assigned_to && x.status !== "completed" && <button disabled={!!busy} onClick={() => void takeOwnership(String(x.id))}>Take ownership</button>}
                  {x.status !== "completed" && <div><label>Completion evidence<textarea value={notes[String(x.id)] ?? ""} onChange={(e) => setNotes((prior) => ({ ...prior, [String(x.id)]: e.target.value }))} className="block w-full rounded border p-2" /></label><button disabled={!!busy || !notes[String(x.id)]?.trim()} onClick={() => void completeAction(String(x.id))}>Complete with my signature</button></div>}
                  {x.completion_notes ? <p>{String(x.completion_notes)}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </RecordDetailSection>
    </div>
  );
}
