/**
 * watchlist-signal-engine: the tick.
 *
 * Two steps. Evaluate every enabled Watchlist rule at each building in scope,
 * through `evaluate_watchlist_signals`, and report per facility.
 *
 * Nothing in this file carries a threshold, a lookback span, a baseline, a
 * severity, a band boundary, a recipient or a channel. All of it lives in
 * `watchlist_signal_rules` and `watchlist_band_rules`, and the Acute push is
 * resolved through `notification_routes` inside the same command, so moving
 * where Acute starts or muting a channel overnight is a row edit rather than a
 * deploy. This file knows only which buildings to ask and what to do when one
 * of them fails.
 *
 * A building whose evaluation raises is a failure, not a quiet success: the
 * tick answers `ok: false` and lists the facilities that did not complete,
 * because a Watchlist that silently stopped evaluating a building is the same
 * defect as a compliance read that answers zero over zero.
 *
 * Everything that touches the database is injected, so the tick can be
 * exercised with fakes. index.ts wires the real service-role client.
 *
 * PHI: no resident name, no room, no clinical detail and no message body is
 * ever logged. Log lines carry facility ids and counts only.
 */

/** What `public.evaluate_watchlist_signals` answers with. */
export interface EvaluationResult {
  ok: boolean;
  reason?: string;
  facility_id?: string;
  evaluated_at?: string;
  matches?: number;
  opened?: number;
  refreshed?: number;
  cleared?: number;
  notified?: number;
}

export interface EngineStore {
  /** Every non-deleted facility in the organization, or the one asked for. */
  loadFacilityIds(organizationId: string, facilityId: string | null): Promise<string[]>;
  evaluateFacility(facilityId: string, atIso: string): Promise<EvaluationResult>;
}

export interface EngineLog {
  log: (entry: Record<string, unknown>) => void;
}

export interface FacilityOutcome {
  facility_id: string;
  ok: boolean;
  reason?: string;
  opened: number;
  refreshed: number;
  cleared: number;
  notified: number;
}

export interface EngineTick {
  facilities_attempted: number;
  facilities_succeeded: number;
  facilities_failed: number;
  failed_facility_ids: string[];
  opened: number;
  refreshed: number;
  cleared: number;
  notified: number;
  facilities: FacilityOutcome[];
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function runWatchlistEngine(args: {
  store: EngineStore;
  log: EngineLog;
  organizationId: string;
  facilityId: string | null;
  now?: () => Date;
}): Promise<EngineTick> {
  const { store, log, organizationId, facilityId } = args;
  const atIso = (args.now ? args.now() : new Date()).toISOString();

  const facilityIds = await store.loadFacilityIds(organizationId, facilityId);

  const outcomes: FacilityOutcome[] = [];
  for (const id of facilityIds) {
    try {
      const result = await store.evaluateFacility(id, atIso);
      outcomes.push({
        facility_id: id,
        ok: result.ok === true,
        reason: result.ok === true ? undefined : (result.reason ?? "evaluation_declined"),
        opened: count(result.opened),
        refreshed: count(result.refreshed),
        cleared: count(result.cleared),
        notified: count(result.notified),
      });
    } catch (error) {
      outcomes.push({
        facility_id: id,
        ok: false,
        reason: error instanceof Error ? error.message : "evaluation_failed",
        opened: 0,
        refreshed: 0,
        cleared: 0,
        notified: 0,
      });
    }
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  const tick: EngineTick = {
    facilities_attempted: outcomes.length,
    facilities_succeeded: outcomes.length - failed.length,
    facilities_failed: failed.length,
    failed_facility_ids: failed.map((outcome) => outcome.facility_id),
    opened: outcomes.reduce((sum, outcome) => sum + outcome.opened, 0),
    refreshed: outcomes.reduce((sum, outcome) => sum + outcome.refreshed, 0),
    cleared: outcomes.reduce((sum, outcome) => sum + outcome.cleared, 0),
    notified: outcomes.reduce((sum, outcome) => sum + outcome.notified, 0),
    facilities: outcomes,
  };

  log.log({
    event: "tick_complete",
    outcome: failed.length > 0 ? "error" : "success",
    facilities_attempted: tick.facilities_attempted,
    facilities_failed: tick.facilities_failed,
    opened: tick.opened,
    cleared: tick.cleared,
    notified: tick.notified,
  });

  return tick;
}
