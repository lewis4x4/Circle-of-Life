"use client";

/**
 * The replay simulation result, spec 25A section 6.7.
 *
 * Every row is the proposal beside the configuration in force, computed by the
 * same replay body over the same resident days, so the difference between them
 * is the configuration and not the method.
 *
 * The honesty line renders whether or not a result is on screen. The replay
 * assumes staff behavior is unchanged, and staff behavior changes when the
 * schedule changes, so this measures the past and does not predict the future.
 * Spec 6.7 requires the surface to say so in one line and never present it as a
 * forecast, which is why the sentence is above the numbers rather than under
 * them.
 */

import { Button } from "@/components/ui/button";
import type { SimulationResult } from "@/lib/rounding/cadence-settings";
import { SIMULATION_HONESTY_LINE } from "@/lib/rounding/cadence-settings-copy";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function CadenceSimulationSummary({
  simulation,
  onSimulate,
  busy,
}: {
  simulation: SimulationResult | null;
  onSimulate: () => void;
  busy: boolean;
}) {
  return (
    <section
      aria-label="Measure the proposal against what already happened"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Measure it against what already happened</h3>
        <Button type="button" variant="outline" size="sm" onClick={onSimulate} disabled={busy}>
          Simulate
        </Button>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">{SIMULATION_HONESTY_LINE}</p>

      {simulation ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <Row
            label="Checks the proposal would have expected"
            value={`${simulation.proposed.windows_generated} (${simulation.in_force.windows_generated} under the schedule in force)`}
          />
          <Row
            label="Of those, met by a check staff recorded"
            value={`${simulation.proposed.would_be_satisfied} (${simulation.in_force.would_be_satisfied} under the schedule in force)`}
          />
          <Row
            label="Missed"
            value={`${simulation.proposed.would_be_missed} (${simulation.in_force.would_be_missed} under the schedule in force)`}
          />
          <Row
            label="Escalations"
            value={`${simulation.proposed.escalations_total} (${simulation.in_force.escalations_total} under the schedule in force)`}
          />
          {simulation.proposed.missed_by_shift.map((row) => (
            <Row key={row.shift_key} label={`Missed on the ${row.shift_key} shift`} value={String(row.missed)} />
          ))}
          {simulation.proposed.escalations_by_rung.map((row) => (
            <Row key={row.rung_key} label={`${row.label} would have fired`} value={String(row.fired)} />
          ))}
          <Row
            label="Staff reminders, which are not escalations"
            value={`${simulation.proposed.nudges_total} (${simulation.in_force.nudges_total} under the schedule in force)`}
          />
          <Row
            label="What was actually recorded over the same days"
            value={`${simulation.recorded.satisfied} of ${simulation.recorded.expected} met, ${simulation.recorded.escalations} escalations`}
          />
          <div className="py-1 sm:col-span-2">
            <p className="text-[13px] tabular-nums text-muted-foreground">
              Measured over {simulation.lookback_days} days, {simulation.from_service_date} to{" "}
              {simulation.to_service_date}.
            </p>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
