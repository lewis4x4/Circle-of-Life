/**
 * Every read and write the cadence settings surface makes. Spec 25A section 6.
 *
 * All of it goes through the RPCs in migration 426. The surface holds no query
 * of its own for two reasons: the recipient resolution and the change log actor
 * names need definer rights the caller does not have, and the window geometry,
 * the validation, the jurisdiction floor and the thresholds all have to be the
 * same answer the activation command will act on. A surface that computed its
 * own preview would show one thing and commit another.
 *
 * `observation_config_overview` is one round trip for the whole of tier 1, and
 * the same call with a proposal on it is the whole of the spec 6.6 preview.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApplyMode,
  ChangeLogEntry,
  ObservationConfigOverview,
  RungDraft,
  SimulationResult,
  WindowDraft,
} from "@/lib/rounding/cadence-settings";

function unwrap<T>(data: unknown, error: { message?: string } | null, step: string): T {
  if (error) throw error;
  if (data == null) throw new Error(`${step} returned nothing`);
  return data as T;
}

/**
 * Tier 1, and the spec 6.6 preview when a proposal is passed.
 *
 * The proposal ids are optional: with neither, the call answers the
 * configuration in force. With either, it answers both sides plus the
 * validation, which is what the preview draws.
 */
export async function fetchObservationConfigOverview(
  supabase: SupabaseClient,
  facilityId: string,
  proposal?: { cadenceVersionId: string | null; escalationVersionId: string | null },
): Promise<ObservationConfigOverview> {
  const { data, error } = await supabase.rpc("observation_config_overview", {
    p_facility_id: facilityId,
    p_proposed_cadence_version_id: proposal?.cadenceVersionId ?? null,
    p_proposed_escalation_version_id: proposal?.escalationVersionId ?? null,
  });
  return unwrap<ObservationConfigOverview>(data, error, "observation_config_overview");
}

/** Tier 3. The page size comes from the facility row, so none is passed. */
export async function fetchObservationConfigChangeLog(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<ChangeLogEntry[]> {
  const { data, error } = await supabase.rpc("observation_config_change_log", {
    p_facility_id: facilityId,
    p_limit: null,
  });
  return unwrap<ChangeLogEntry[]>(data, error, "observation_config_change_log");
}

export type CreatedVersions = {
  status: string;
  cadence_version_id: string | null;
  escalation_version_id: string | null;
  cadence_version_number: number | null;
  escalation_version_number: number | null;
  provisional_effective_from: string;
};

/**
 * Proposes a change. Windows and rungs are both optional, and passing null for
 * one means that kind of configuration is not changing, so editing a single
 * rung does not manufacture a cadence version identical to the one in force.
 */
export async function createCadenceVersion(
  supabase: SupabaseClient,
  args: {
    facilityId: string;
    changeReason: string;
    windows: WindowDraft[] | null;
    rungs: RungDraft[] | null;
  },
): Promise<CreatedVersions> {
  const { data, error } = await supabase.rpc("create_cadence_version", {
    p_facility_id: args.facilityId,
    p_change_reason: args.changeReason,
    p_windows: args.windows,
    p_escalation_rungs: args.rungs,
    p_effective_from: null,
    p_source_cadence_template_id: null,
    p_source_escalation_template_id: null,
  });
  return unwrap<CreatedVersions>(data, error, "create_cadence_version");
}

export type ActivationAnswer = {
  effective_from: string;
  scheduled: boolean;
  in_force: boolean;
  acknowledgment_required: boolean;
};

/**
 * Puts a proposal in force, or schedules it. The effective timing, the six hard
 * blocks and the typed acknowledgment are all enforced inside the command, so a
 * refusal here is the command's own sentence and is worth showing.
 */
export async function activateCadenceVersion(
  supabase: SupabaseClient,
  args: {
    changeReason: string;
    cadenceVersionId: string | null;
    escalationVersionId: string | null;
    applyMode: ApplyMode;
    effectiveFrom: string | null;
    acknowledgment: string | null;
  },
): Promise<ActivationAnswer> {
  const { data, error } = await supabase.rpc("activate_cadence_version", {
    p_change_reason: args.changeReason,
    p_cadence_version_id: args.cadenceVersionId,
    p_escalation_version_id: args.escalationVersionId,
    p_apply_mode: args.applyMode,
    p_effective_from: args.effectiveFrom,
    p_acknowledgment: args.acknowledgment,
  });
  return unwrap<ActivationAnswer>(data, error, "activate_cadence_version");
}

/** Copies an earlier version forward. Never deletes one, never rewrites one. */
export async function rollbackCadenceVersion(
  supabase: SupabaseClient,
  args: {
    facilityId: string;
    changeReason: string;
    restoreCadenceVersionId: string | null;
    restoreEscalationVersionId: string | null;
    applyMode: ApplyMode;
    effectiveFrom: string | null;
    acknowledgment: string | null;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("rollback_cadence_version", {
    p_facility_id: args.facilityId,
    p_change_reason: args.changeReason,
    p_restore_cadence_version_id: args.restoreCadenceVersionId,
    p_restore_escalation_version_id: args.restoreEscalationVersionId,
    p_apply_mode: args.applyMode,
    p_effective_from: args.effectiveFrom,
    p_acknowledgment: args.acknowledgment,
  });
  return unwrap<Record<string, unknown>>(data, error, "rollback_cadence_version");
}

/**
 * Replays the proposal against what staff actually recorded. The lookback comes
 * from the facility row, so the surface names no span.
 */
export async function simulateCadenceChange(
  supabase: SupabaseClient,
  args: {
    facilityId: string;
    cadenceVersionId: string | null;
    escalationVersionId: string | null;
  },
): Promise<SimulationResult> {
  const { data, error } = await supabase.rpc("simulate_cadence_change", {
    p_facility_id: args.facilityId,
    p_proposed_cadence_version_id: args.cadenceVersionId,
    p_proposed_escalation_version_id: args.escalationVersionId,
    p_lookback_days: null,
  });
  return unwrap<SimulationResult>(data, error, "simulate_cadence_change");
}

export type TestSendAnswer = {
  rung_key: string;
  label: string;
  shift_key: string | null;
  recipients: number;
  deliveries_queued: number;
  escalation_recorded: boolean;
};

/** Sends one rung through the real routing with TEST as the first word. */
export async function sendTestEscalation(
  supabase: SupabaseClient,
  facilityId: string,
  rungKey: string,
): Promise<TestSendAnswer> {
  const { data, error } = await supabase.rpc("send_test_escalation", {
    p_facility_id: facilityId,
    p_rung_key: rungKey,
  });
  return unwrap<TestSendAnswer>(data, error, "send_test_escalation");
}
