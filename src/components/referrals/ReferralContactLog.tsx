"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { createClient } from "@/lib/supabase/client";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  INTERACTION_METHOD_OPTIONS,
  buildNextActionCommand,
  buildRecordInteractionCommand,
  contactLogPeople,
  describeContactLogEvent,
  emptyContactLogDraft,
  newContactLogRequestKey,
  sortContactLogEvents,
  validateContactLogDraft,
  validateNextStepDraft,
  type ContactLogDraft,
  type ContactLogErrors,
  type ContactLogEvent,
  type NextStepDraft,
} from "@/lib/referrals/contact-log";
import {
  loadReferralEpisodeHistory,
  runReferralEpisodeCommand,
  type ReferralEpisodeModel,
} from "@/lib/referrals/referral-authority";

type HistoryState =
  | { status: "loading" }
  | { status: "loaded"; events: ContactLogEvent[]; truncated: boolean }
  | { status: "failed"; message: string };

const FIELD_CLASS =
  "w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Postgres serialization failure: the lead changed after this page read it. */
function isRevisionConflict(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null;
  return record?.code === "40001" || /reload before saving/i.test(record?.message ?? "");
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message;
  return message && message.trim() ? message : fallback;
}

export type ReferralContactLogProps = {
  leadId: string;
  prospectName: string;
  canWrite: boolean;
  episode: ReferralEpisodeModel["episode"] | null;
  contacts: ReferralEpisodeModel["contacts"];
  /** Re-read the episode after a save so the revision and next step stay current. */
  onEpisodeChanged: () => Promise<void>;
};

export function ReferralContactLog({
  leadId,
  prospectName,
  canWrite,
  episode,
  contacts,
  onEpisodeChanged,
}: ReferralContactLogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [draft, setDraft] = useState<ContactLogDraft>(emptyContactLogDraft);
  const [errors, setErrors] = useState<ContactLogErrors>({});
  const [saving, setSaving] = useState<"log" | "next" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [nextDraft, setNextDraft] = useState<NextStepDraft>({ nextAction: "", nextActionDue: "" });
  const [nextErrors, setNextErrors] = useState<Partial<Record<keyof NextStepDraft, string>>>({});
  const [editingNext, setEditingNext] = useState(false);
  const logKeyRef = useRef<string>(newContactLogRequestKey());
  const nextKeyRef = useRef<string>(newContactLogRequestKey());

  const people = useMemo(() => contactLogPeople(prospectName, contacts), [prospectName, contacts]);
  const closed = episode?.work_state === "closed";
  const writable = canWrite && Boolean(episode) && !closed;

  const loadHistory = useCallback(async () => {
    try {
      const page = await loadReferralEpisodeHistory(supabase, { episodeId: leadId, limit: 200 });
      setHistory({
        status: "loaded",
        events: sortContactLogEvents(page.events),
        truncated: page.next_before_sequence !== null,
      });
    } catch (loadError) {
      setHistory({ status: "failed", message: errorMessage(loadError, "The history could not be read.") });
    }
  }, [supabase, leadId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadHistory());
  }, [loadHistory]);

  function update<K extends keyof ContactLogDraft>(key: K, value: ContactLogDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function saveLog() {
    if (!episode) return;
    const found = validateContactLogDraft(draft);
    setErrors(found);
    setSaveMessage(null);
    setSaveError(null);
    if (Object.values(found).some(Boolean)) return;
    setSaving("log");
    try {
      await runReferralEpisodeCommand(supabase, {
        episodeId: leadId,
        requestKey: logKeyRef.current,
        expectedRevision: episode.episode_revision,
        command: buildRecordInteractionCommand(draft, people),
      });
      logKeyRef.current = newContactLogRequestKey();
      setDraft(emptyContactLogDraft());
      setSaveMessage("Contact logged.");
      await Promise.all([onEpisodeChanged(), loadHistory()]);
    } catch (saveFailure) {
      if (isRevisionConflict(saveFailure)) {
        // A different revision is a different request: mint a new key, keep the words.
        logKeyRef.current = newContactLogRequestKey();
        setSaveError("Someone else updated this lead while you were writing. Your entry is still here. Check the history, then save again.");
        await Promise.all([onEpisodeChanged(), loadHistory()]);
      } else {
        // Keep the key: if the save did land, saving again replays it instead of logging twice.
        setSaveError(`The contact was not saved: ${errorMessage(saveFailure, "try again.")}`);
      }
    } finally {
      setSaving(null);
    }
  }

  async function saveNextStep() {
    if (!episode) return;
    const found = validateNextStepDraft(nextDraft);
    setNextErrors(found);
    setSaveMessage(null);
    setSaveError(null);
    if (Object.values(found).some(Boolean)) return;
    setSaving("next");
    try {
      await runReferralEpisodeCommand(supabase, {
        episodeId: leadId,
        requestKey: nextKeyRef.current,
        expectedRevision: episode.episode_revision,
        command: buildNextActionCommand(nextDraft),
      });
      nextKeyRef.current = newContactLogRequestKey();
      setNextDraft({ nextAction: "", nextActionDue: "" });
      setEditingNext(false);
      setSaveMessage("Next step saved.");
      await Promise.all([onEpisodeChanged(), loadHistory()]);
    } catch (saveFailure) {
      if (isRevisionConflict(saveFailure)) {
        nextKeyRef.current = newContactLogRequestKey();
        setSaveError("Someone else updated this lead while you were writing. Your next step is still here. Check it, then save again.");
        await Promise.all([onEpisodeChanged(), loadHistory()]);
      } else {
        setSaveError(`The next step was not saved: ${errorMessage(saveFailure, "try again.")}`);
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <RecordDetailSection
        title="Next step"
        description="What happens next with this prospective resident, and when it is due."
      >
        <div className="space-y-4 text-sm">
          {episode?.next_action ? (
            <div>
              <p className="font-medium text-foreground">{episode.next_action}</p>
              <p className={episode.is_overdue ? "text-destructive" : "text-muted-foreground"}>
                {episode.next_action_at ? `Due ${formatFacilityTimestampEt(episode.next_action_at)}` : "No due time recorded"}
                {episode.is_overdue ? " (overdue)" : ""}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No next step is set.</p>
          )}
          {writable && !editingNext ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingNext(true)}>
              {episode?.next_action ? "Change next step" : "Set next step"}
            </Button>
          ) : null}
          {writable && editingNext ? (
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <label className="space-y-1">
                <span className={LABEL_CLASS}>Next step</span>
                <input
                  type="text"
                  value={nextDraft.nextAction}
                  onChange={(event) => {
                    setNextDraft((current) => ({ ...current, nextAction: event.target.value }));
                    setNextErrors((current) => ({ ...current, nextAction: undefined }));
                  }}
                  maxLength={2000}
                  aria-invalid={Boolean(nextErrors.nextAction)}
                  className={FIELD_CLASS}
                />
                {nextErrors.nextAction ? <span className="text-xs text-destructive">{nextErrors.nextAction}</span> : null}
              </label>
              <label className="space-y-1">
                <span className={LABEL_CLASS}>Due (Eastern Time)</span>
                <input
                  type="datetime-local"
                  value={nextDraft.nextActionDue}
                  onChange={(event) => {
                    setNextDraft((current) => ({ ...current, nextActionDue: event.target.value }));
                    setNextErrors((current) => ({ ...current, nextActionDue: undefined }));
                  }}
                  aria-label="Next step due (Eastern Time)"
                  aria-invalid={Boolean(nextErrors.nextActionDue)}
                  className={FIELD_CLASS}
                />
                {nextErrors.nextActionDue ? <span className="text-xs text-destructive">{nextErrors.nextActionDue}</span> : null}
              </label>
              <div className="flex gap-2 md:col-span-2 md:justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingNext(false)} disabled={saving === "next"}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => void saveNextStep()} disabled={saving !== null}>
                  {saving === "next" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save next step
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Contact log"
        description="Every call, visit, message and note about this prospective resident, newest first."
      >
        <div className="space-y-6 text-sm">
          {saveError ? (
            <p className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
          {saveMessage ? (
            <p className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-success" role="status">
              {saveMessage}
            </p>
          ) : null}

          {writable ? (
            <form
              aria-label="Log a contact"
              className="space-y-4 rounded-[8px] border border-border bg-muted/10 px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveLog();
              }}
              noValidate
            >
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1">
                  <span className={LABEL_CLASS}>When (Eastern Time)</span>
                  <input
                    type="datetime-local"
                    value={draft.occurredAt}
                    onChange={(event) => update("occurredAt", event.target.value)}
                    aria-label="When the contact happened (Eastern Time)"
                    aria-invalid={Boolean(errors.occurredAt)}
                    className={FIELD_CLASS}
                  />
                  {errors.occurredAt ? <span className="text-xs text-destructive">{errors.occurredAt}</span> : null}
                </label>
                <label className="space-y-1">
                  <span className={LABEL_CLASS}>How</span>
                  <select
                    value={draft.method}
                    onChange={(event) => update("method", event.target.value as ContactLogDraft["method"])}
                    aria-label="How the contact happened"
                    aria-invalid={Boolean(errors.method)}
                    className={FIELD_CLASS}
                  >
                    <option value="">Choose how</option>
                    {INTERACTION_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {errors.method ? <span className="text-xs text-destructive">{errors.method}</span> : null}
                </label>
                <label className="space-y-1">
                  <span className={LABEL_CLASS}>With</span>
                  <select
                    value={draft.who}
                    onChange={(event) => update("who", event.target.value)}
                    aria-label="Who the contact was with"
                    aria-invalid={Boolean(errors.who)}
                    className={FIELD_CLASS}
                  >
                    <option value="">Choose who</option>
                    {people.map((person) => (
                      <option key={person.value} value={person.value}>
                        {person.label}
                      </option>
                    ))}
                  </select>
                  {errors.who ? <span className="text-xs text-destructive">{errors.who}</span> : null}
                </label>
              </div>
              {draft.who === "other" ? (
                <label className="block space-y-1">
                  <span className={LABEL_CLASS}>Name and relationship</span>
                  <input
                    type="text"
                    value={draft.otherName}
                    onChange={(event) => update("otherName", event.target.value)}
                    maxLength={200}
                    aria-label="Who the contact was with"
                    aria-invalid={Boolean(errors.otherName)}
                    className={FIELD_CLASS}
                  />
                  {errors.otherName ? <span className="text-xs text-destructive">{errors.otherName}</span> : null}
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>What was said or done</span>
                <textarea
                  value={draft.summary}
                  onChange={(event) => update("summary", event.target.value)}
                  rows={4}
                  maxLength={4000}
                  aria-label="What was said or done"
                  aria-invalid={Boolean(errors.summary)}
                  className={FIELD_CLASS}
                />
                {errors.summary ? <span className="text-xs text-destructive">{errors.summary}</span> : null}
              </label>
              <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
                <label className="space-y-1">
                  <span className={LABEL_CLASS}>Next step (optional)</span>
                  <input
                    type="text"
                    value={draft.nextAction}
                    onChange={(event) => update("nextAction", event.target.value)}
                    maxLength={2000}
                    aria-label="Next step after this contact"
                    aria-invalid={Boolean(errors.nextAction)}
                    className={FIELD_CLASS}
                  />
                  {errors.nextAction ? <span className="text-xs text-destructive">{errors.nextAction}</span> : null}
                </label>
                <label className="space-y-1">
                  <span className={LABEL_CLASS}>Next step due</span>
                  <input
                    type="datetime-local"
                    value={draft.nextActionDue}
                    onChange={(event) => update("nextActionDue", event.target.value)}
                    aria-label="Next step after this contact due (Eastern Time)"
                    aria-invalid={Boolean(errors.nextActionDue)}
                    className={FIELD_CLASS}
                  />
                  {errors.nextActionDue ? <span className="text-xs text-destructive">{errors.nextActionDue}</span> : null}
                </label>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving !== null}>
                  {saving === "log" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Log contact
                </Button>
              </div>
            </form>
          ) : closed ? (
            <p className="text-muted-foreground">This referral is closed. Reopen it to log another contact.</p>
          ) : !canWrite ? (
            <p className="text-muted-foreground">Your role can read this log but not add to it.</p>
          ) : null}

          {history.status === "loading" ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading history…
            </p>
          ) : history.status === "failed" ? (
            <p className="text-muted-foreground" role="status">
              The history could not be read: {history.message}
            </p>
          ) : history.events.length === 0 ? (
            <p className="text-muted-foreground">Nothing has been logged yet.</p>
          ) : (
            <ol aria-label="Referral history" className="divide-y divide-border">
              {history.events.map((event) => {
                const entry = describeContactLogEvent(event);
                return (
                  <li key={entry.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-foreground">
                      {entry.title}
                      <span className="ml-2 font-normal text-muted-foreground">{entry.when}</span>
                    </p>
                    {entry.lines.map((line, index) => (
                      <p key={index} className="whitespace-pre-wrap text-foreground">
                        {line}
                      </p>
                    ))}
                    {entry.restricted ? (
                      <p className="text-muted-foreground">The note on this entry is restricted for your role.</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">By {entry.by}</p>
                  </li>
                );
              })}
            </ol>
          )}
          {history.status === "loaded" && history.truncated ? (
            <p className="text-xs text-muted-foreground">Showing the latest {history.events.length} entries.</p>
          ) : null}
        </div>
      </RecordDetailSection>
    </>
  );
}
