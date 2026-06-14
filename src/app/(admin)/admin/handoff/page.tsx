"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  HANDOFF_CATEGORIES,
  HANDOFF_SHIFTS,
  currentShift,
  handoffCategoryLabel,
  priorityTone,
  todayEtIso,
  type HandoffCategory,
  type HandoffNoteRow,
  type HandoffPriority,
  type HandoffShift,
  type QueryResult,
  type ResidentMini,
} from "@/lib/office/handoff";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminHandoffPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const now = useMemo(() => new Date(), []);
  const [shiftDate, setShiftDate] = useState(() => todayEtIso(now));
  const [shift, setShift] = useState<HandoffShift>(() => currentShift(now));

  const [notes, setNotes] = useState<HandoffNoteRow[]>([]);
  const [residents, setResidents] = useState<ResidentMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [category, setCategory] = useState<HandoffCategory>("resident");
  const [priority, setPriority] = useState<HandoffPriority>("normal");
  const [residentId, setResidentId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setNotes([]);
      setResidents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const fid = selectedFacilityId as string;
      const notesRes = (await supabase
        .from("shift_handoff_notes" as never)
        .select(
          "id, shift_date, shift, category, resident_id, note, priority, acknowledged_by, acknowledged_at, created_at",
        )
        .eq("facility_id", fid)
        .eq("shift_date", shiftDate)
        .eq("shift", shift)
        .is("deleted_at", null)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<HandoffNoteRow>;
      if (notesRes.error) throw new Error(notesRes.error.message);
      setNotes(notesRes.data ?? []);

      const resRes = (await supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("last_name")) as unknown as QueryResult<ResidentMini>;
      if (!resRes.error) setResidents(resRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the handoff board.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, shiftDate, shift]);

  useEffect(() => {
    void load();
  }, [load]);

  const postNote = useCallback(async () => {
    if (!facilityReady || !text.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("shift_handoff_notes" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        shift_date: shiftDate,
        shift,
        category,
        priority,
        resident_id: residentId || null,
        note: text.trim(),
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setText("");
      setResidentId("");
      setPriority("normal");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to post the note.");
    } finally {
      setSaving(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, shiftDate, shift, category, priority, residentId, text, load]);

  const acknowledge = useCallback(
    async (noteRow: HandoffNoteRow) => {
      setBusyId(noteRow.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const { error } = await supabase
          .from("shift_handoff_notes" as never)
          .update({
            acknowledged_by: actor.userId,
            acknowledged_at: new Date().toISOString(),
            updated_by: actor.userId,
          } as never)
          .eq("id", noteRow.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to acknowledge.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

  const residentName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const r = residents.find((x) => x.id === id);
      return r ? `${r.first_name} ${r.last_name}`.trim() : null;
    },
    [residents],
  );

  const openCount = useMemo(() => notes.filter((n) => !n.acknowledged_at).length, [notes]);

  const inputCls = "rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <ClipboardCheck className="h-8 w-8 text-info shrink-0" aria-hidden />
            Shift handoff
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            What the incoming shift needs to know. {openCount} unacknowledged on this shift.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — the handoff board is per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Shift date
              <input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={inputCls} />
            </label>
            <div className="flex gap-1.5">
              {HANDOFF_SHIFTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={shift === s.id}
                  onClick={() => setShift(s.id)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    shift === s.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground border border-border hover:bg-muted",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {facilityReady ? (
          <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-4">
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Handoff note…" aria-label="Handoff note" className={cn(inputCls, "lg:col-span-4")} />
            <select value={category} onChange={(e) => setCategory(e.target.value as HandoffCategory)} aria-label="Category" className={inputCls}>
              {HANDOFF_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as HandoffPriority)} aria-label="Priority" className={inputCls}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select value={residentId} onChange={(e) => setResidentId(e.target.value)} aria-label="Resident (optional)" className={inputCls}>
              <option value="">Resident (optional)…</option>
              {residents.map((r) => <option key={r.id} value={r.id}>{r.last_name}, {r.first_name}</option>)}
            </select>
            <Button type="button" disabled={saving || !text.trim()} onClick={() => void postNote()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Post
            </Button>
          </div>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          notes.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">No handoff notes for this shift yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex flex-col gap-2 px-[13px] py-2 rounded-[9px] border bg-card lg:flex-row lg:items-center lg:justify-between",
                    n.acknowledged_at ? "border-border opacity-70" : "border-border",
                  )}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm text-foreground">{n.note}</span>
                    <span className="text-xs text-muted-foreground">
                      {handoffCategoryLabel(n.category)}
                      {residentName(n.resident_id) ? ` · ${residentName(n.resident_id)}` : ""} ·{" "}
                      {TIME_FMT.format(new Date(n.created_at))} ET
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill tone={priorityTone(n.priority)}>{n.priority}</StatusPill>
                    {n.acknowledged_at ? (
                      <StatusPill tone="success">acknowledged</StatusPill>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled={busyId === n.id} onClick={() => void acknowledge(n)}>
                        Acknowledge
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
