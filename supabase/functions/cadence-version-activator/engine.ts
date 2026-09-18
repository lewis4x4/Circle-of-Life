/**
 * cadence-version-activator: the tick.
 *
 * Two steps per building in scope. Activate every scheduled cadence and
 * escalation version whose effective_from has passed, through
 * `activate_due_scheduled_config_versions`, and then ask the task generator to
 * rebuild the board for any building where a cadence version actually took
 * force and cancelled pending tasks.
 *
 * Nothing in this file carries an observation time, a grace value, an
 * escalation offset, a recipient, a channel, a shift boundary, a threshold or a
 * lookback span. The whole of the activation, including the refusal to activate
 * backwards and the refusal to move effective_from on a version that has
 * already generated a task, lives in the SQL command. This file knows only
 * which organization to ask about and what to do when a building fails.
 *
 * Regeneration is requested, never performed here. A cadence change cancels the
 * pending tasks that sit past its effective_from, which frees the idempotency
 * slot on (resident_id, window_key, service_date); the generator then writes the
 * replacements on its own terms. Two functions generating tasks would be two
 * places to change a window time, which is the defect this whole module exists
 * to remove. When no generator URL is configured the tick says regeneration was
 * not requested and why, rather than implying the board was rebuilt.
 *
 * A building whose activation fails is reported as a failure with HTTP 207, not
 * folded into a cheerful ok. A scheduled cadence change that silently did not
 * happen leaves staff working yesterday's schedule while the settings surface
 * shows today's.
 *
 * PHI: no resident name, no room, no clinical detail and no message body is ever
 * logged. Log lines carry facility ids, version ids and counts only.
 */

/** What `public.activate_due_scheduled_config_versions` answers with. */
export interface ActivationOutcome {
  ok: boolean;
  kind?: string;
  facility_id?: string;
  version_id?: string;
  version_number?: number;
  effective_from?: string;
  superseded_version_id?: string | null;
  pending_tasks_cancelled?: number;
  reason?: string;
}

export interface ActivationResult {
  ok: boolean;
  organization_id?: string;
  at?: string;
  versions_due?: number;
  versions_activated?: number;
  versions_failed?: number;
  versions?: ActivationOutcome[];
}

export interface EngineStore {
  /** Activates every scheduled version whose effective_from has passed. */
  activateDueVersions(organizationId: string, facilityId: string | null, atIso: string): Promise<ActivationResult>;
  /**
   * Asks the observation task generator to rebuild one building's next shift.
   * Returns null when no generator endpoint is configured, which is reported
   * rather than treated as success.
   */
  requestRegeneration(organizationId: string, facilityId: string): Promise<boolean | null>;
}

export interface EngineLog {
  log: (entry: Record<string, unknown>) => void;
}

export interface EngineTick {
  versions_due: number;
  versions_activated: number;
  versions_failed: number;
  failed_version_ids: string[];
  pending_tasks_cancelled: number;
  facilities_regenerated: string[];
  regeneration_requested: boolean;
  regeneration_skipped_reason: string | null;
  versions: ActivationOutcome[];
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function runCadenceVersionActivator(args: {
  store: EngineStore;
  log: EngineLog;
  organizationId: string;
  facilityId: string | null;
  now?: () => Date;
}): Promise<EngineTick> {
  const { store, log, organizationId, facilityId } = args;
  const atIso = (args.now ? args.now() : new Date()).toISOString();

  const result = await store.activateDueVersions(organizationId, facilityId, atIso);
  const outcomes = result.versions ?? [];

  const failed = outcomes.filter((outcome) => !outcome.ok);
  const cancelled = outcomes.reduce((sum, outcome) => sum + count(outcome.pending_tasks_cancelled), 0);

  /* Only a cadence version that actually took force and cancelled pending tasks
     leaves a hole in the board. An escalation change moves who hears about a
     missed check and generates nothing, so it never needs a regeneration. */
  const needsRegeneration = Array.from(
    new Set(
      outcomes
        .filter((outcome) => outcome.ok && outcome.kind === "cadence" && count(outcome.pending_tasks_cancelled) > 0)
        .map((outcome) => outcome.facility_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const regenerated: string[] = [];
  let regenerationRequested = false;
  let regenerationSkippedReason: string | null = null;

  for (const id of needsRegeneration) {
    const requested = await store.requestRegeneration(organizationId, id);
    if (requested === null) {
      regenerationSkippedReason = "no_generator_endpoint_configured";
      continue;
    }
    regenerationRequested = true;
    if (requested) regenerated.push(id);
  }

  if (needsRegeneration.length === 0) regenerationSkippedReason = "nothing_to_regenerate";

  const tick: EngineTick = {
    versions_due: count(result.versions_due) || outcomes.length,
    versions_activated: count(result.versions_activated),
    versions_failed: count(result.versions_failed) || failed.length,
    failed_version_ids: failed.map((outcome) => outcome.version_id ?? "unknown"),
    pending_tasks_cancelled: cancelled,
    facilities_regenerated: regenerated,
    regeneration_requested: regenerationRequested,
    regeneration_skipped_reason: regenerationSkippedReason,
    versions: outcomes,
  };

  log.log({
    event: "tick_complete",
    outcome: tick.versions_failed > 0 ? "error" : "success",
    versions_due: tick.versions_due,
    versions_activated: tick.versions_activated,
    versions_failed: tick.versions_failed,
    pending_tasks_cancelled: tick.pending_tasks_cancelled,
    facilities_regenerated: tick.facilities_regenerated.length,
    regeneration_requested: tick.regeneration_requested,
    regeneration_skipped_reason: tick.regeneration_skipped_reason,
  });

  return tick;
}
