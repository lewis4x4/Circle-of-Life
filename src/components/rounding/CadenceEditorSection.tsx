"use client";

/**
 * Tier 2 of the cadence settings surface. Spec 25A section 6.13.
 *
 * One check or one step at a time, because a form that offers all six windows
 * and four rungs at once is a form nobody reads before submitting. The reason
 * field is required and stays on the record: spec 6.11 puts a change reason on
 * every configuration change, and a change log full of blank reasons is a
 * change log nobody consults.
 *
 * The detach warning names what the building stops inheriting before it
 * happens, per spec 6.8, rather than after.
 */

import { CadenceRungEditor } from "@/components/rounding/CadenceRungEditor";
import { CadenceWindowEditor } from "@/components/rounding/CadenceWindowEditor";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ObservationConfigOverview,
  RungDraft,
  WindowDraft,
} from "@/lib/rounding/cadence-settings";
import {
  DETACH_WARNING,
  PROPOSAL_REASON_HELPER,
  PROPOSAL_REASON_LABEL,
} from "@/lib/rounding/cadence-settings-copy";

export function CadenceEditorSection({
  overview,
  windowDrafts,
  rungDrafts,
  openWindowKey,
  openRungKey,
  onOpenWindow,
  onWindowChange,
  onRungChange,
  reason,
  onReasonChange,
  onPropose,
  onDiscard,
  showReason,
  locked,
  busy,
}: {
  overview: ObservationConfigOverview;
  windowDrafts: WindowDraft[];
  rungDrafts: RungDraft[];
  openWindowKey: string | null;
  openRungKey: string | null;
  onOpenWindow: (windowKey: string) => void;
  onWindowChange: (next: WindowDraft) => void;
  onRungChange: (next: RungDraft) => void;
  reason: string;
  onReasonChange: (next: string) => void;
  onPropose: () => void;
  onDiscard: () => void;
  showReason: boolean;
  locked: boolean;
  busy: boolean;
}) {
  const channels = Array.from(new Set(overview.current.ladder.flatMap((rung) => rung.channels)));
  const roles = Array.from(
    new Map(overview.current.ladder.flatMap((rung) => rung.roles).map((role) => [role.staff_role, role])).values(),
  );

  return (
    <section aria-label="Change one check or one step" className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Change one check or one step</h2>
      {overview.cadence_template_name ? (
        <p className="text-[13px] leading-relaxed text-warning">{DETACH_WARNING}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {windowDrafts.map((draft) => (
          <Button
            key={draft.window_key}
            type="button"
            variant={openWindowKey === draft.window_key ? "outline" : "ghost"}
            size="sm"
            onClick={() => onOpenWindow(draft.window_key)}
          >
            {draft.label}
          </Button>
        ))}
      </div>

      {windowDrafts
        .filter((draft) => draft.window_key === openWindowKey)
        .map((draft) => (
          <CadenceWindowEditor
            key={draft.window_key}
            draft={draft}
            shifts={overview.shifts}
            disabled={busy || locked}
            onChange={onWindowChange}
          />
        ))}

      {rungDrafts
        .filter((draft) => draft.rung_key === openRungKey)
        .map((draft) => (
          <CadenceRungEditor
            key={draft.rung_key}
            draft={draft}
            channels={channels}
            roles={roles}
            disabled={busy || locked}
            onChange={onRungChange}
          />
        ))}

      {showReason ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <FormLabel htmlFor="cadence-proposal-reason" required>
              {PROPOSAL_REASON_LABEL}
            </FormLabel>
            <Textarea
              id="cadence-proposal-reason"
              rows={2}
              value={reason}
              disabled={busy}
              onChange={(event) => onReasonChange(event.target.value)}
            />
            <p className="text-[13px] text-muted-foreground">{PROPOSAL_REASON_HELPER}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onPropose} disabled={busy || reason.trim() === ""}>
              Save and preview
            </Button>
            <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy}>
              Discard these edits
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
