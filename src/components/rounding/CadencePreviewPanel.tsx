"use client";

/**
 * Preview before commit, spec 25A section 6.6, and the effective timing of 6.4.
 *
 * Current against proposed: both 24 hour strips, checks per resident per day,
 * the daily task total from the live active resident count, the ladder in wall
 * clock terms, and the recipient resolution per step. Every number comes from
 * `observation_config_overview` with the proposal on it, which is the same
 * answer `activate_cadence_version` will act on, so the preview cannot show one
 * thing and the commit do another.
 *
 * The six hard blocks are refused in the database. They are listed here so an
 * administrator reads them before submitting, not instead of.
 */

import { AlertTriangle, ShieldAlert } from "lucide-react";

import { CadencePolicyDiff } from "@/components/rounding/CadencePolicyDiff";
import { rungDraftsFrom, shiftsFromConfiguration } from "@/lib/rounding/cadence-settings";
import { CadenceLadderList } from "@/components/rounding/CadenceLadderList";
import { CadenceSimulationSummary } from "@/components/rounding/CadenceSimulationSummary";
import { CadenceWindowStrip } from "@/components/rounding/CadenceWindowStrip";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  APPLY_MODES,
  APPLY_MODE_HELPERS,
  APPLY_MODE_LABELS,
  formatSpanMinutes,
  type ApplyMode,
  type ObservationConfigOverview,
  type SimulationResult,
} from "@/lib/rounding/cadence-settings";
import {
  ACKNOWLEDGMENT_HELPER,
  ACTIVATION_REASON_HELPER,
  ACTIVATION_REASON_LABEL,
} from "@/lib/rounding/cadence-settings-copy";

export function CadencePreviewPanel({
  overview,
  simulation,
  activationReason,
  onActivationReasonChange,
  applyMode,
  onApplyModeChange,
  scheduledFor,
  onScheduledForChange,
  acknowledgment,
  onAcknowledgmentChange,
  onSimulate,
  onCommit,
  onDiscard,
  busy,
}: {
  overview: ObservationConfigOverview;
  simulation: SimulationResult | null;
  activationReason: string;
  onActivationReasonChange: (next: string) => void;
  applyMode: ApplyMode;
  onApplyModeChange: (next: ApplyMode) => void;
  scheduledFor: string;
  onScheduledForChange: (next: string) => void;
  acknowledgment: string;
  onAcknowledgmentChange: (next: string) => void;
  onSimulate: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const proposed = overview.proposed;
  if (!proposed) return null;
  const validation = proposed.validation;
  const candidateShape = proposed.day_shape ?? (proposed.cadence_version_id == null ? overview.current.day_shape : null);
  const candidateTotal = proposed.daily_task_total ?? (proposed.cadence_version_id == null ? overview.current.daily_task_total : null);
  const candidateShifts = proposed.configuration ? shiftsFromConfiguration(proposed.configuration) : overview.shifts;
  const candidateLadder = proposed.escalation_version_id == null ? overview.current.ladder : proposed.ladder;
  const blocked = validation?.ok !== true || candidateShape == null || (proposed.escalation_version_id != null && candidateLadder.length === 0);
  const needsAcknowledgment =
    applyMode !== "next_shift_boundary" || (validation?.warnings.length ?? 0) > 0;

  return (
    <section aria-label="Preview this change before it goes in force" className="space-y-5">
      <h2 className="text-sm font-semibold text-foreground">Before this goes in force</h2>

      {blocked ? (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <ShieldAlert aria-hidden className="size-4 text-destructive" />
            This change cannot go in force yet
          </p>
          <ul className="space-y-1">
            {validation?.blocks.map((block) => (
              <li key={`${block.code}-${block.message}`} className="text-[13px] leading-relaxed text-foreground">
                {block.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(validation?.warnings.length ?? 0) > 0 ? (
        <div role="status" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <AlertTriangle aria-hidden className="size-4 text-warning" />
            Worth a second look before you confirm
          </p>
          <ul className="space-y-1">
            {validation?.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`} className="text-[13px] leading-relaxed text-foreground">
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Checks per resident per day"
          value={candidateShape?.windows_per_day ?? "Unavailable"}
          numericValue={candidateShape?.windows_per_day}
          thresholds={{ type: "informational" }}
          hint={`Now ${overview.current.day_shape?.windows_per_day ?? 0}`}
        />
        <MetricCard
          label="Checks a day across the building"
          value={candidateTotal ?? "Unavailable"}
          numericValue={candidateTotal ?? undefined}
          thresholds={{ type: "informational" }}
          hint={`${overview.active_resident_count} residents in the building right now`}
        />
        <MetricCard
          label="Longest unobserved span"
          value={candidateShape ? formatSpanMinutes(candidateShape.largest_unobserved_gap_minutes) : "Unavailable"}
          numericValue={candidateShape?.largest_unobserved_gap_minutes}
          thresholds={{ type: "informational" }}
          hint={`Now ${formatSpanMinutes(overview.current.day_shape?.largest_unobserved_gap_minutes ?? 0)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {overview.current.day_shape ? (
          <CadenceWindowStrip
            shape={overview.current.day_shape}
            shifts={overview.shifts}
            label="The day as it runs now"
          />
        ) : null}
        {candidateShape ? (
          <CadenceWindowStrip
            shape={candidateShape}
            shifts={candidateShifts}
            label="The day as proposed"
          />
        ) : null}
      </div>

      {candidateLadder.length > 0 && candidateShape ? (
        <CadenceLadderList
          ladder={candidateLadder}
          shape={candidateShape}
          label="The ladder as proposed, in wall clock terms"
        />
      ) : null}

      <section aria-label="Escalation policy changes" className="space-y-3">
        <h3 className="text-sm font-semibold">Escalation instructions, recipients and shift changes</h3>
        <CadencePolicyDiff before={rungDraftsFrom(overview.current.ladder)} after={rungDraftsFrom(candidateLadder)} />
      </section>

      <CadenceSimulationSummary simulation={simulation} onSimulate={onSimulate} busy={busy} />

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">When it takes effect</h3>

        <div className="space-y-2">
          <FormLabel htmlFor="cadence-apply-mode" required>
            Effective timing
          </FormLabel>
          <Select value={applyMode} disabled={busy} onValueChange={(next) => onApplyModeChange(next as ApplyMode)}>
            <SelectTrigger id="cadence-apply-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLY_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {APPLY_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{APPLY_MODE_HELPERS[applyMode]}</p>
          {applyMode === "next_shift_boundary" && overview.next_shift_boundary_at ? (
            <p className="text-[13px] text-muted-foreground">
              The next boundary is {new Date(overview.next_shift_boundary_at).toLocaleString()}.
            </p>
          ) : null}
        </div>

        {applyMode === "scheduled" ? (
          <div className="space-y-2">
            <FormLabel htmlFor="cadence-scheduled-for" required>
              Date and time
            </FormLabel>
            <DateTimePicker
              id="cadence-scheduled-for"
              value={scheduledFor}
              disabled={busy}
              required
              onValueChange={onScheduledForChange}
            />
            <p className="text-[13px] text-muted-foreground">Shown in your local timezone.</p>
          </div>
        ) : null}

        <div className="space-y-2">
          <FormLabel htmlFor="cadence-activation-reason" required>
            {ACTIVATION_REASON_LABEL}
          </FormLabel>
          <Textarea
            id="cadence-activation-reason"
            rows={2}
            value={activationReason}
            disabled={busy}
            onChange={(event) => onActivationReasonChange(event.target.value)}
          />
          <p className="text-[13px] text-muted-foreground">{ACTIVATION_REASON_HELPER}</p>
        </div>

        {needsAcknowledgment ? (
          <div className="space-y-2">
            <FormLabel htmlFor="cadence-acknowledgment" required>
              Confirm by typing {overview.facility_name}
            </FormLabel>
            <Input
              id="cadence-acknowledgment"
              value={acknowledgment}
              disabled={busy}
              onChange={(event) => onAcknowledgmentChange(event.target.value)}
            />
            <p className="text-[13px] text-muted-foreground">{ACKNOWLEDGMENT_HELPER}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="button" onClick={onCommit} disabled={busy || blocked || activationReason.trim() === ""}>
            {applyMode === "immediate" ? "Put in force now" : "Schedule this change"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy}>
            Leave it as a proposal
          </Button>
        </div>
      </div>
    </section>
  );
}
