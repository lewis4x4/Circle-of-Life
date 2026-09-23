"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { fetchFloorCensus } from "@/lib/floor/floor-data";
import { acknowledgeHandoffNote, fetchHandoffNotes, postHandoffNote } from "@/lib/floor/handoff-notes";
import { dropFloorCache } from "@/lib/floor/memory-cache";
import { floorShiftWindow } from "@/lib/floor/shift-window";
import { enumLabel } from "@/lib/display/enum-label";
import { formatDisplayTime, formatShortDateTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { useFloorSession } from "./FloorContext";
import { useFloorNow } from "./FloorClock";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING, FLOOR_OUTLINE_BUTTON, FLOOR_PRIMARY_BUTTON, FLOOR_SECTION_LABEL } from "./floor-styles";
import { useFloorQuery } from "./useFloorQuery";

/**
 * `/floor/handoff` (spec 40 §6 screen 7): the building's shared shift notes,
 * newest first. Read one to mark it read (it counts on My shift), or post one
 * for the next shift.
 */
export function FloorHandoffScreen() {
  const { supabase, facility, profile, timeZone } = useFloorSession();
  const facilityId = facility.facilityId;
  const now = useFloorNow();
  const draftId = useId();
  const notes = useFloorQuery(`handoff:${facilityId}`, () => fetchHandoffNotes(supabase, facilityId), 30_000);
  const census = useFloorQuery(`census:${facilityId}`, () => fetchFloorCensus(supabase, facilityId), 5 * 60_000);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const shiftWindow = now ? floorShiftWindow(facility, now) : null;
  const residents = new Map((census.state.status === "success" ? census.state.data : []).map((row) => [row.id, row] as const));

  async function run(key: string, work: () => Promise<void>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      await work();
      dropFloorCache("activity:");
      setMessage(done);
      notes.reload();
    } catch {
      setMessage("That did not save. Check the Wi-Fi and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold text-foreground">Handoff</h1>
        {shiftWindow ? (
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            {shiftWindow.label ? `${shiftWindow.label} shift` : "Shift"}
            {shiftWindow.endIso ? ` · hands off at ${formatDisplayTime(shiftWindow.endIso, { timeZone })}` : ""}
          </p>
        ) : null}
      </div>

      <section aria-labelledby={draftId} className="mt-4 flex flex-col gap-2 rounded-[12px] border border-border bg-card p-4">
        <label id={draftId} htmlFor={`${draftId}-input`} className="text-[15px] font-semibold text-foreground">
          Leave a note for the next shift
        </label>
        <textarea
          id={`${draftId}-input`}
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
          rows={3}
          className={cn("rounded-[8px] border border-input bg-background p-3 text-base text-foreground", FLOOR_FOCUS_RING)}
        />
        <button
          type="button"
          disabled={busy !== null || !draft.trim()}
          onClick={() =>
            void run("post", async () => {
              await postHandoffNote(supabase, { facility, userId: profile.userId, note: draft });
              setDraft("");
            }, "Note posted.")
          }
          className={cn(FLOOR_PRIMARY_BUTTON, "h-12 w-fit px-5 text-[15px]")}
        >
          Post note
        </button>
      </section>
      <p role="status" aria-live="polite" className={cn("mt-2 text-sm text-foreground", !message && "sr-only")}>
        {message ?? ""}
      </p>

      <h2 className={cn(FLOOR_SECTION_LABEL, "mt-4")}>Shift notes</h2>
      <div className="mt-1.5 border-t border-border">
        {notes.state.status === "error" ? (
          <FloorStatePanel state="error" title="The shift notes could not load." onRetry={notes.reload} />
        ) : notes.state.status !== "success" ? (
          <FloorStatePanel state="loading" title="Loading shift notes" />
        ) : notes.state.data.length === 0 ? (
          <FloorStatePanel state="empty" title="No shift notes yet." detail="Notes the care and office teams leave for each other show here." />
        ) : (
          <ul>
            {notes.state.data.map((note) => {
              const resident = note.residentId ? residents.get(note.residentId) : null;
              return (
                <li key={note.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 pr-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="whitespace-pre-wrap break-words text-[15px] text-foreground">{note.note}</p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">
                      {[enumLabel(note.shift), formatShortDateTime(note.createdAt, { timeZone }), note.authorName].filter(Boolean).join(" · ")}
                    </p>
                    {resident ? (
                      <Link href={`/floor/residents/${resident.id}`} className={cn("inline-flex min-h-11 w-fit items-center text-[13px] font-medium text-floor-link hover:underline", FLOOR_FOCUS_RING)}>
                        {resident.room ? `Rm ${resident.room} · ` : ""}
                        {resident.name}
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {note.priority !== "normal" ? <StatusPill tone="warning" className="h-6 text-xs">{enumLabel(note.priority)}</StatusPill> : null}
                    {note.acknowledgedAt ? (
                      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <Check className="size-4" aria-hidden />
                        Read {formatDisplayTime(note.acknowledgedAt, { timeZone })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run(note.id, () => acknowledgeHandoffNote(supabase, { noteId: note.id, userId: profile.userId }), "Marked read.")}
                        className={cn(FLOOR_OUTLINE_BUTTON, "h-11 px-4 text-sm font-medium")}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
