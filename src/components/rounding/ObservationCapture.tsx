"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { ObservationChipRow } from "@/components/rounding/ObservationChipRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  OBSERVATION_CHIP_GROUPS,
  OBSERVATION_CHIP_GROUP_HEADINGS,
  OBSERVATION_QUICK_STATUS_OPTIONS,
  composeObservationPreview,
  countObservationChips,
  describeObservationGaps,
  emptyObservationVocabCatalog,
  isObservationSubmittable,
  normalizeObservationChips,
  toggleObservationChip,
  type ObservationChipSelections,
  type ObservationVocabCatalog,
} from "@/lib/rounding/observation-chips";
import type { CompletionPayload, ObservationQuickStatus } from "@/lib/rounding/types";

function selectionsFromPayload(payload: CompletionPayload | undefined): ObservationChipSelections {
  const source = payload?.chipSelections;
  if (!source) return {};
  const result: ObservationChipSelections = {};
  for (const group of OBSERVATION_CHIP_GROUPS) {
    const codes = source[group];
    if (Array.isArray(codes) && codes.length > 0) result[group] = [...codes];
  }
  return result;
}

/**
 * One window, one resident, one screen.
 *
 * Every group is visible at once. There is no wizard, no step and no
 * navigation between groups. The note is optional, secondary, and never the
 * reason a check cannot be recorded.
 */
export function ObservationCapture({
  residentName,
  dueLabel,
  facilityId,
  submitting,
  pendingPayload,
  reasonRequired = false,
  onSubmit,
}: {
  residentName: string;
  dueLabel: string;
  facilityId?: string | null;
  submitting?: boolean;
  pendingPayload?: CompletionPayload;
  reasonRequired?: boolean;
  onSubmit: (payload: CompletionPayload) => Promise<void> | void;
}) {
  const [catalog, setCatalog] = useState<ObservationVocabCatalog>(emptyObservationVocabCatalog);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [quickStatus, setQuickStatus] = useState<ObservationQuickStatus | null>(pendingPayload?.quickStatus ?? null);
  const [residentLocation, setResidentLocation] = useState<string | null>(pendingPayload?.residentLocation ?? null);
  const [residentState, setResidentState] = useState<string | null>(pendingPayload?.residentState ?? null);
  const [chipSelections, setChipSelections] = useState<ObservationChipSelections>(() => selectionsFromPayload(pendingPayload));
  const [note, setNote] = useState(pendingPayload?.note ?? "");
  const [lateReason, setLateReason] = useState(pendingPayload?.lateReason ?? "");

  const retained = Boolean(pendingPayload);
  const locked = retained || Boolean(submitting);

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    async function loadCatalog(id: string) {
      try {
        const response = await fetch(`/api/rounding/vocabulary?facilityId=${encodeURIComponent(id)}`, { cache: "no-store" });
        const json = (await response.json()) as Partial<ObservationVocabCatalog>;
        if (cancelled || !response.ok) return;
        setCatalog({ ...emptyObservationVocabCatalog(), ...json });
      } catch {
        // An unreachable vocabulary leaves the rows empty; each row says so.
      } finally {
        if (!cancelled) setCatalogLoaded(true);
      }
    }
    void loadCatalog(facilityId);
    return () => {
      cancelled = true;
    };
  }, [facilityId]);

  const draft = useMemo(
    () => ({ quickStatus, residentLocation, residentState, chipSelections }),
    [chipSelections, quickStatus, residentLocation, residentState],
  );
  const preview = useMemo(() => composeObservationPreview(draft, catalog), [catalog, draft]);
  const gaps = useMemo(() => describeObservationGaps(draft), [draft]);
  const ready = retained || isObservationSubmittable(draft);

  async function record() {
    if (submitting || !ready) return;
    const payload: CompletionPayload = pendingPayload
      ? { ...pendingPayload, ...(reasonRequired ? { lateReason: lateReason.trim() || null } : {}) }
      : {
        quickStatus: quickStatus as ObservationQuickStatus,
        residentLocation,
        residentState,
        chipSelections: normalizeObservationChips(chipSelections, catalog) as Record<string, string[]>,
        note: note.trim() || null,
        lateReason: lateReason.trim() || null,
        distressPresent: quickStatus === "distressed",
        refusedAssistance: quickStatus === "refused",
      };
    try {
      await onSubmit(payload);
    } catch {
      // The caller retains the attempt and renders its own message.
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Check for {residentName}</CardTitle>
        <CardDescription>{dueLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {retained ? (
          <p role="status" className="text-sm text-muted-foreground">
            This check is retained exactly as it was tapped. Record sends those details again.
          </p>
        ) : null}

        <ObservationChipRow
          heading="Status"
          options={OBSERVATION_QUICK_STATUS_OPTIONS}
          selected={quickStatus ? [quickStatus] : []}
          disabled={locked}
          onToggle={(code) => setQuickStatus(code as ObservationQuickStatus)}
        />
        <ObservationChipRow
          heading="Where"
          options={catalog.location}
          selected={residentLocation ? [residentLocation] : []}
          disabled={locked}
          emptyLine="Locations appear once an administrator adds them for this building."
          onToggle={setResidentLocation}
        />
        <ObservationChipRow
          heading="How they presented"
          options={catalog.state}
          selected={residentState ? [residentState] : []}
          disabled={locked}
          emptyLine="Presentations appear once an administrator adds them for this building."
          onToggle={setResidentState}
        />
        {OBSERVATION_CHIP_GROUPS.map((group) => (
          <ObservationChipRow
            key={group}
            multiple
            heading={OBSERVATION_CHIP_GROUP_HEADINGS[group]}
            options={catalog[group]}
            selected={chipSelections[group] ?? []}
            disabled={locked}
            onToggle={(code) => setChipSelections((current) => toggleObservationChip(current, group, code))}
          />
        ))}

        <section className="space-y-1 rounded-[var(--radius)] border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-medium text-muted-foreground">This is what gets recorded</h3>
          <p className="text-base text-foreground" data-testid="observation-preview">
            {preview}
            {note.trim() ? ` ${note.trim()}` : ""}
          </p>
        </section>

        <section className="space-y-1">
          <label htmlFor="observation-note" className="text-sm text-muted-foreground">
            Note, if there is something to add
          </label>
          <Textarea
            id="observation-note"
            value={note}
            disabled={locked}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </section>

        {reasonRequired ? (
          <section className="space-y-1">
            <label htmlFor="observation-late-reason" className="text-sm text-muted-foreground">
              Reason this went in after the window
            </label>
            <Input
              id="observation-late-reason"
              value={lateReason}
              disabled={Boolean(submitting)}
              onChange={(event) => setLateReason(event.target.value)}
              placeholder="Required only for delayed entries"
            />
          </section>
        ) : null}

        {!ready && (catalogLoaded || !facilityId) ? (
          <div className="space-y-1 text-sm">
            <p className="text-foreground">Not ready to record yet.</p>
            <p className="text-muted-foreground">Still needed: {gaps.join(", ")}.</p>
          </div>
        ) : null}

        <Button
          type="button"
          className="min-h-[56px] w-full text-base"
          disabled={Boolean(submitting) || !ready}
          onClick={() => void record()}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          Record check
        </Button>
        <p className="text-sm text-muted-foreground">
          {countObservationChips(chipSelections) > 0 || retained
            ? "Tap Record when this reads right."
            : "Tap one chip from meals, mood or medications."}
        </p>
      </CardContent>
    </Card>
  );
}
