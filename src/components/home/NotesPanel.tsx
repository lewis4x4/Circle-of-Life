"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NOTE_TYPES, appendNote, assigneeLabel, type HomeNoteOnTap, type NoteType } from "@/lib/home/notes";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { CARD_CLASS, CARD_HEAD_CLASS } from "./home-styles";

type NoteRecord = { id: string; note_type: string; body: string; status: string; follow_up_date: string | null; created_at: string };
type UpdateRecord = { id: string; body: string; closed_note: boolean; created_at: string };

export type NotesPanelProps = {
  facilityId: string;
  currentUserId: string | null;
  onTap: HomeNoteOnTap[];
  onChanged?: () => void;
  /** Injected in tests. */
  searchNotes?: (facilityId: string, type: NoteType | "") => Promise<NoteRecord[]>;
  loadThread?: (noteId: string) => Promise<UpdateRecord[]>;
  append?: typeof appendNote;
};

async function defaultSearch(facilityId: string, type: NoteType | ""): Promise<NoteRecord[]> {
  let query = createClient()
    .from("home_notes" as never)
    .select("id, note_type, body, status, follow_up_date, created_at")
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (type) query = query.eq("note_type", type);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as NoteRecord[];
}

async function defaultThread(noteId: string): Promise<UpdateRecord[]> {
  const { data, error } = await createClient()
    .from("home_note_updates" as never)
    .select("id, body, closed_note, created_at")
    .eq("note_id", noteId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as UpdateRecord[];
}

function NoteThread({ noteId, open: noteOpen, onChanged, loadThread, append }: { noteId: string; open: boolean; onChanged?: () => void; loadThread: (id: string) => Promise<UpdateRecord[]>; append: typeof appendNote }) {
  const ids = useId();
  const [thread, setThread] = useState<UpdateRecord[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { loadThread(noteId).then(setThread).catch(() => setThread([])); }, [loadThread, noteId]);
  useEffect(() => { reload(); }, [reload]);

  async function send(close: boolean) {
    const body = text.trim() || (close ? "Closed." : "");
    if (!body || busy) return;
    setBusy(true);
    const result = await append(createClient(), { id: crypto.randomUUID(), noteId, body, close });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setText(""); setError(null); reload(); onChanged?.();
  }

  return (
    <div className="mt-2 space-y-2">
      <ol className="list-none space-y-1 text-xs text-muted-foreground">
        {thread?.map((u) => <li key={u.id}>{u.closed_note ? "Closed: " : ""}{u.body}</li>)}
      </ol>
      {noteOpen ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-update`} className="sr-only">Add an update</label>
          <textarea id={`${ids}-update`} className="min-h-12 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an update" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send(true)}>Close it</Button>
            <Button type="button" size="sm" disabled={busy || !text.trim()} onClick={() => void send(false)}>Add update</Button>
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Notes and tasks on Home (COL-595): what is on tap for you today, and every
 * note for the building, searchable by type. Each note is one thread.
 */
export function NotesPanel({ facilityId, currentUserId, onTap, onChanged, searchNotes = defaultSearch, loadThread = defaultThread, append = appendNote }: NotesPanelProps) {
  const [type, setType] = useState<NoteType | "">("");
  const [results, setResults] = useState<NoteRecord[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    searchNotes(facilityId, type).then((rows) => { if (active) setResults(rows); }).catch(() => { if (active) setResults([]); });
    return () => { active = false; };
  }, [facilityId, type, searchNotes]);

  return (
    <section className={cn(CARD_CLASS, "overflow-hidden")} aria-labelledby="notes-heading" data-testid="notes-panel">
      <div className={CARD_HEAD_CLASS}>
        <h2 id="notes-heading" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <NotebookPen className="size-4 text-muted-foreground" aria-hidden /> Notes and tasks
        </h2>
      </div>
      {onTap.length > 0 ? (
        <ul className="list-none" aria-label="Tasks on tap">
          {onTap.map((note) => (
            <li key={note.noteId} id={`note-${note.noteId}`} className="border-b border-border/60 px-4 py-2.5 text-[13px]">
              <button type="button" className="text-left text-foreground hover:underline" aria-expanded={expanded === note.noteId} onClick={() => setExpanded(expanded === note.noteId ? null : note.noteId)}>
                {note.body}
              </button>
              <p className="text-xs text-muted-foreground">
                {assigneeLabel(note.assignee, currentUserId)}{note.followUpDate ? ` · follow up ${note.followUpDate}` : ""}{note.overdue ? " · overdue" : ""}
              </p>
              {expanded === note.noteId ? <NoteThread noteId={note.noteId} open onChanged={onChanged} loadThread={loadThread} append={append} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5" role="radiogroup" aria-label="Filter notes by type">
        <Button type="button" size="sm" variant={type === "" ? "default" : "outline"} role="radio" aria-checked={type === ""} onClick={() => setType("")}>All</Button>
        {NOTE_TYPES.map((t) => (
          <Button key={t.value} type="button" size="sm" variant={type === t.value ? "default" : "outline"} role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)}>{t.label}</Button>
        ))}
      </div>
      <ul className="list-none" aria-label="Notes">
        {results === null ? <li className="px-4 py-2 text-xs text-muted-foreground">Loading…</li> : null}
        {results?.length === 0 ? <li className="px-4 py-2 text-xs text-muted-foreground">No notes of this type yet.</li> : null}
        {results?.map((note) => (
          <li key={note.id} className="border-t border-border/60 px-4 py-2 text-[13px]">
            <button type="button" className="text-left text-foreground hover:underline" aria-expanded={expanded === note.id} onClick={() => setExpanded(expanded === note.id ? null : note.id)}>
              {note.body}
            </button>
            <p className="text-xs text-muted-foreground">
              {NOTE_TYPES.find((t) => t.value === note.note_type)?.label ?? note.note_type} · {note.created_at.slice(0, 10)}{note.status === "done" ? " · closed" : ""}
            </p>
            {expanded === note.id ? <NoteThread noteId={note.id} open={note.status !== "done"} onChanged={onChanged} loadThread={loadThread} append={append} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
