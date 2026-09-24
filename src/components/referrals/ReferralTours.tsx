"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { enumLabel } from "@/lib/display/enum-label";
import { createClient } from "@/lib/supabase/client";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  loadReferralEpisodeTours,
  runReferralTourCommand,
  type ReferralEpisodeTours,
  type ReferralTour,
  type ReferralTourCommand,
} from "@/lib/referrals/referral-authority";
import {
  TOUR_RESULT_OPTIONS,
  buildRescheduleTourCommand,
  buildScheduleTourCommand,
  buildTourResultCommand,
  countedTours,
  emptyRescheduleTourDraft,
  emptyScheduleTourDraft,
  emptyTourResultDraft,
  newTourRequestKey,
  tourStateLabel,
  validateRescheduleTourDraft,
  validateScheduleTourDraft,
  validateTourResultDraft,
  type DraftErrors,
  type RescheduleTourDraft,
  type ScheduleTourDraft,
  type TourResultDraft,
} from "@/lib/referrals/tours";

type ToursState =
  | { status: "loading" }
  | { status: "loaded"; data: ReferralEpisodeTours }
  | { status: "failed"; message: string };

type Mode =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "reschedule"; tourId: string }
  | { kind: "result"; tourId: string };

const FIELD_CLASS =
  "w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

function isRevisionConflict(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null;
  return record?.code === "40001" || /reload before saving/i.test(record?.message ?? "");
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message;
  return message && message.trim() ? message : fallback;
}

export type ReferralToursProps = {
  leadId: string;
  /** The lead's status before a save, to say when a tour moved it. */
  leadStatus: string;
  /** The lead's current revision from the page; the tour read supplies one when this is not known. */
  episodeRevision: string | null;
  /** Re-read the lead, its revision and its history after a tour is saved. */
  onChanged: () => Promise<void>;
};

export function ReferralTours({ leadId, leadStatus, episodeRevision, onChanged }: ReferralToursProps) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ToursState>({ status: "loading" });
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleTourDraft>(emptyScheduleTourDraft);
  const [scheduleErrors, setScheduleErrors] = useState<DraftErrors<ScheduleTourDraft>>({});
  const [rescheduleDraft, setRescheduleDraft] = useState<RescheduleTourDraft>(emptyRescheduleTourDraft);
  const [rescheduleErrors, setRescheduleErrors] = useState<DraftErrors<RescheduleTourDraft>>({});
  const [resultDraft, setResultDraft] = useState<TourResultDraft>(emptyTourResultDraft);
  const [resultErrors, setResultErrors] = useState<DraftErrors<TourResultDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const keyRef = useRef<string>(newTourRequestKey());

  const loadTours = useCallback(async () => {
    try {
      setState({ status: "loaded", data: await loadReferralEpisodeTours(supabase, leadId) });
    } catch (loadError) {
      setState({ status: "failed", message: errorMessage(loadError, "The tours could not be read.") });
    }
  }, [supabase, leadId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadTours());
  }, [loadTours]);

  const data = state.status === "loaded" ? state.data : null;
  const writable = Boolean(data?.can_write);
  const [now] = useState(() => new Date());

  function openMode(next: Mode) {
    // A result or new time belongs to one tour; opening another starts empty.
    if (next.kind === "result") {
      setResultDraft(emptyTourResultDraft());
      setResultErrors({});
    } else if (next.kind === "reschedule") {
      setRescheduleDraft(emptyRescheduleTourDraft());
      setRescheduleErrors({});
    }
    setMode(next);
    setSaveError(null);
    setSaveMessage(null);
    keyRef.current = newTourRequestKey();
  }

  async function save(command: ReferralTourCommand, success: string, reset: () => void) {
    const revision = episodeRevision ?? data?.episode_revision ?? null;
    if (!revision) {
      setSaveError("This lead could not be read. Reload the page, then save again.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const reply = await runReferralTourCommand(supabase, {
        episodeId: leadId,
        requestKey: keyRef.current,
        expectedRevision: revision,
        command,
      });
      keyRef.current = newTourRequestKey();
      reset();
      setMode({ kind: "none" });
      setSaveMessage(
        reply.status !== leadStatus ? `${success} The lead moved to ${enumLabel(reply.status)}.` : success,
      );
      await Promise.all([loadTours(), onChanged()]);
    } catch (saveFailure) {
      if (isRevisionConflict(saveFailure)) {
        // A different revision is a different request: new key, keep what was typed.
        keyRef.current = newTourRequestKey();
        setSaveError("Someone else updated this lead while you were writing. Your entry is still here. Check the tours, then save again.");
        await Promise.all([loadTours(), onChanged()]);
      } else {
        // Keep the key: if the save did land, saving again replays it instead of recording twice.
        setSaveError(`The tour was not saved: ${errorMessage(saveFailure, "try again.")}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function submitSchedule() {
    const found = validateScheduleTourDraft(scheduleDraft);
    setScheduleErrors(found);
    if (Object.values(found).some(Boolean)) return;
    void save(buildScheduleTourCommand(scheduleDraft), "Tour saved.", () => setScheduleDraft(emptyScheduleTourDraft()));
  }

  function submitReschedule(tour: ReferralTour) {
    const found = validateRescheduleTourDraft(rescheduleDraft, tour);
    setRescheduleErrors(found);
    if (Object.values(found).some(Boolean)) return;
    void save(buildRescheduleTourCommand(tour.id, rescheduleDraft), "Tour rescheduled.", () =>
      setRescheduleDraft(emptyRescheduleTourDraft()),
    );
  }

  function submitResult(tour: ReferralTour) {
    const found = validateTourResultDraft(resultDraft, new Date());
    setResultErrors(found);
    if (Object.values(found).some(Boolean)) return;
    void save(buildTourResultCommand(tour.id, resultDraft), "Tour result saved.", () =>
      setResultDraft(emptyTourResultDraft()),
    );
  }

  const owners = data?.eligible_owners ?? [];
  const selfId = data?.self_user_id ?? null;
  const ownerLabel = (person: { user_id: string; full_name: string }) =>
    person.user_id === selfId ? `${person.full_name} (you)` : person.full_name;
  const byId = new Map((data?.tours ?? []).map((tour) => [tour.id, tour]));
  const counted = data ? countedTours(data.tours).length : 0;

  return (
    <RecordDetailSection
      title="Tours"
      description={
        data?.facility_name
          ? `Every tour of ${data.facility_name} for this prospective resident, with who gives it and what happened.`
          : "Every tour for this prospective resident, with who gives it and what happened."
      }
    >
      <div className="space-y-4 text-sm">
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

        {state.status === "loading" ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading tours…
          </p>
        ) : state.status === "failed" ? (
          <p className="text-muted-foreground" role="status">
            The tours could not be read: {state.message}
          </p>
        ) : state.data.tours.length === 0 ? (
          <p className="text-muted-foreground">No tour is recorded yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {counted === 1 ? "1 tour" : `${counted} tours`}; a rescheduled tour counts once.
            </p>
            <ul aria-label="Tours" className="divide-y divide-border">
              {state.data.tours.map((tour) => {
                const successor = tour.replaced_by_tour_id ? byId.get(tour.replaced_by_tour_id) : undefined;
                const predecessor = tour.replaces_tour_id ? byId.get(tour.replaces_tour_id) : undefined;
                const open = tour.outcome === "scheduled";
                return (
                  <li key={tour.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-foreground">
                      {tour.scheduled_for ? formatFacilityTimestampEt(tour.scheduled_for) : "Scheduled time not recorded"}
                      <span className="ml-2 rounded-[6px] border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {tourStateLabel(tour, now)}
                      </span>
                    </p>
                    <p className="text-foreground">Given by {tour.owner_name ?? "no one recorded"}</p>
                    {tour.completed_at ? (
                      <p className="text-foreground">Completed {formatFacilityTimestampEt(tour.completed_at)}</p>
                    ) : null}
                    {predecessor?.scheduled_for ? (
                      <p className="text-muted-foreground">
                        Rescheduled from {formatFacilityTimestampEt(predecessor.scheduled_for)}
                      </p>
                    ) : null}
                    {successor?.scheduled_for ? (
                      <p className="text-muted-foreground">Moved to {formatFacilityTimestampEt(successor.scheduled_for)}</p>
                    ) : null}
                    {tour.feedback_note ? (
                      <p className="whitespace-pre-wrap text-foreground">{tour.feedback_note}</p>
                    ) : tour.feedback_restricted ? (
                      <p className="text-muted-foreground">The feedback on this tour is restricted for your role.</p>
                    ) : null}
                    {tour.backfilled ? (
                      <p className="text-xs text-muted-foreground">
                        Copied from this lead&apos;s earlier tour fields. Only the times recorded there were kept.
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {tour.recorded_by_name ? `Recorded by ${tour.recorded_by_name}` : "Recorded before tours had their own list"}
                      {tour.outcome_recorded_by_name && tour.outcome_recorded_at
                        ? `; result recorded by ${tour.outcome_recorded_by_name}, ${formatFacilityTimestampEt(tour.outcome_recorded_at)}`
                        : ""}
                    </p>

                    {writable && open && mode.kind === "none" ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => openMode({ kind: "result", tourId: tour.id })}>
                          Record result
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => openMode({ kind: "reschedule", tourId: tour.id })}>
                          Reschedule
                        </Button>
                      </div>
                    ) : null}

                    {writable && mode.kind === "result" && mode.tourId === tour.id ? (
                      <form
                        aria-label="Record the tour result"
                        className="mt-2 space-y-4 rounded-[8px] border border-border bg-muted/10 px-4 py-4"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitResult(tour);
                        }}
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1">
                            <span className={LABEL_CLASS}>What happened</span>
                            <select
                              value={resultDraft.outcome}
                              onChange={(event) => {
                                setResultDraft((current) => ({ ...current, outcome: event.target.value as TourResultDraft["outcome"] }));
                                setResultErrors((current) => ({ ...current, outcome: undefined }));
                              }}
                              aria-label="What happened on the tour"
                              aria-invalid={Boolean(resultErrors.outcome)}
                              className={FIELD_CLASS}
                            >
                              <option value="">Choose what happened</option>
                              {TOUR_RESULT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {resultErrors.outcome ? <span className="text-xs text-destructive">{resultErrors.outcome}</span> : null}
                          </label>
                          {resultDraft.outcome === "completed" ? (
                            <label className="space-y-1">
                              <span className={LABEL_CLASS}>Completed at (Eastern Time)</span>
                              <input
                                type="datetime-local"
                                value={resultDraft.completedAt}
                                onChange={(event) => {
                                  setResultDraft((current) => ({ ...current, completedAt: event.target.value }));
                                  setResultErrors((current) => ({ ...current, completedAt: undefined }));
                                }}
                                aria-label="When the tour was completed (Eastern Time)"
                                aria-invalid={Boolean(resultErrors.completedAt)}
                                className={FIELD_CLASS}
                              />
                              {resultErrors.completedAt ? <span className="text-xs text-destructive">{resultErrors.completedAt}</span> : null}
                            </label>
                          ) : null}
                        </div>
                        <label className="block space-y-1">
                          <span className={LABEL_CLASS}>Feedback (optional)</span>
                          <textarea
                            value={resultDraft.feedback}
                            onChange={(event) => setResultDraft((current) => ({ ...current, feedback: event.target.value }))}
                            rows={3}
                            maxLength={4000}
                            aria-label="Tour feedback"
                            className={FIELD_CLASS}
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setMode({ kind: "none" })} disabled={saving}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                            Save result
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {writable && mode.kind === "reschedule" && mode.tourId === tour.id ? (
                      <form
                        aria-label="Reschedule the tour"
                        className="mt-2 space-y-4 rounded-[8px] border border-border bg-muted/10 px-4 py-4"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitReschedule(tour);
                        }}
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1">
                            <span className={LABEL_CLASS}>New time (Eastern Time)</span>
                            <input
                              type="datetime-local"
                              value={rescheduleDraft.scheduledFor}
                              onChange={(event) => {
                                setRescheduleDraft((current) => ({ ...current, scheduledFor: event.target.value }));
                                setRescheduleErrors((current) => ({ ...current, scheduledFor: undefined }));
                              }}
                              aria-label="New tour time (Eastern Time)"
                              aria-invalid={Boolean(rescheduleErrors.scheduledFor)}
                              className={FIELD_CLASS}
                            />
                            {rescheduleErrors.scheduledFor ? <span className="text-xs text-destructive">{rescheduleErrors.scheduledFor}</span> : null}
                          </label>
                          <label className="space-y-1">
                            <span className={LABEL_CLASS}>Given by</span>
                            <select
                              value={rescheduleDraft.ownerUserId}
                              onChange={(event) => {
                                setRescheduleDraft((current) => ({ ...current, ownerUserId: event.target.value }));
                                setRescheduleErrors((current) => ({ ...current, ownerUserId: undefined }));
                              }}
                              aria-label="Who gives the rescheduled tour"
                              aria-invalid={Boolean(rescheduleErrors.ownerUserId)}
                              className={FIELD_CLASS}
                            >
                              <option value="">{tour.owner_name ? `Keep ${tour.owner_name}` : "Choose who"}</option>
                              {owners
                                .filter((person) => person.user_id !== tour.owner_user_id)
                                .map((person) => (
                                  <option key={person.user_id} value={person.user_id}>
                                    {ownerLabel(person)}
                                  </option>
                                ))}
                            </select>
                            {rescheduleErrors.ownerUserId ? <span className="text-xs text-destructive">{rescheduleErrors.ownerUserId}</span> : null}
                          </label>
                        </div>
                        <label className="block space-y-1">
                          <span className={LABEL_CLASS}>Why it moved (optional)</span>
                          <textarea
                            value={rescheduleDraft.note}
                            onChange={(event) => setRescheduleDraft((current) => ({ ...current, note: event.target.value }))}
                            rows={2}
                            maxLength={4000}
                            aria-label="Why the tour moved"
                            className={FIELD_CLASS}
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setMode({ kind: "none" })} disabled={saving}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                            Save new time
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {writable && mode.kind === "add" ? (
          <form
            aria-label="Add a tour"
            className="space-y-4 rounded-[8px] border border-border bg-muted/10 px-4 py-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitSchedule();
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className={LABEL_CLASS}>When (Eastern Time)</span>
                <input
                  type="datetime-local"
                  value={scheduleDraft.scheduledFor}
                  onChange={(event) => {
                    setScheduleDraft((current) => ({ ...current, scheduledFor: event.target.value }));
                    setScheduleErrors((current) => ({ ...current, scheduledFor: undefined }));
                  }}
                  aria-label="Tour time (Eastern Time)"
                  aria-invalid={Boolean(scheduleErrors.scheduledFor)}
                  className={FIELD_CLASS}
                />
                {scheduleErrors.scheduledFor ? <span className="text-xs text-destructive">{scheduleErrors.scheduledFor}</span> : null}
              </label>
              <label className="space-y-1">
                <span className={LABEL_CLASS}>Given by</span>
                <select
                  value={scheduleDraft.ownerUserId}
                  onChange={(event) => {
                    setScheduleDraft((current) => ({ ...current, ownerUserId: event.target.value }));
                    setScheduleErrors((current) => ({ ...current, ownerUserId: undefined }));
                  }}
                  aria-label="Who gives the tour"
                  aria-invalid={Boolean(scheduleErrors.ownerUserId)}
                  className={FIELD_CLASS}
                >
                  <option value="">Choose who</option>
                  {owners.map((person) => (
                    <option key={person.user_id} value={person.user_id}>
                      {ownerLabel(person)}
                    </option>
                  ))}
                </select>
                {scheduleErrors.ownerUserId ? <span className="text-xs text-destructive">{scheduleErrors.ownerUserId}</span> : null}
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              A tour that already happened is added here first, then its result is recorded.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode({ kind: "none" })} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Save tour
              </Button>
            </div>
          </form>
        ) : null}

        {writable && mode.kind === "none" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => openMode({ kind: "add" })}>
            Add a tour
          </Button>
        ) : data && !data.can_write ? (
          <p className="text-muted-foreground">Your role can read these tours but not record them, or this referral is closed.</p>
        ) : null}
      </div>
    </RecordDetailSection>
  );
}
