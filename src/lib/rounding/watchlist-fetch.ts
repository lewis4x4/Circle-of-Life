/**
 * Reads for the three Watchlist tiers. Spec 25A section 7.5.
 *
 * All three views run on the reader's authority, so the only scoping this file
 * does is asking for the building the operator selected. A reader who can reach
 * one building gets one building's rows whatever this file asks for, which is
 * the point of `security_invoker` on the views.
 *
 * Nothing here reads `resident_safety_scores`. Spec decision D6 retires the AI
 * scorer from this surface; it keeps its other consumers, which live outside the
 * Smart Rounding module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WatchlistPortfolioRow {
  organization_id: string;
  facility_id: string;
  facility_name: string;
  residents_on_watchlist: number;
  open_signal_count: number;
  open_acute_signal_count: number;
  acute_resident_count: number;
  data_quality_signal_count: number;
  worst_band_key: string | null;
  worst_band_label: string | null;
  worst_band_rank: number | null;
  risk_index_latest: number | null;
  trend_direction: string | null;
}

export interface WatchlistSignalRow {
  organization_id: string;
  facility_id: string;
  facility_name: string;
  resident_id: string;
  resident_first_name: string | null;
  resident_last_name: string | null;
  resident_preferred_name: string | null;
  room_number: string | null;
  signal_instance_id: string;
  signal_key: string;
  signal_label: string;
  signal_description: string;
  severity_class: string;
  source_kind: string;
  status: string;
  first_detected_at: string;
  last_evaluated_at: string;
  observed_count: number;
  evidence: Record<string, unknown> | null;
  days_open: number | null;
  disposition_note: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  band_key: string | null;
  band_label: string | null;
  band_rank: number | null;
  open_signal_count: number;
}

export interface WatchlistDispositionRow {
  id: string;
  ledger_seq: number;
  signal_instance_id: string;
  signal_key: string;
  resident_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_kind: string;
  acted_by: string | null;
  acted_by_name: string | null;
  acted_by_role: string | null;
  acted_at: string;
}

type RawDispositionRow = Omit<WatchlistDispositionRow, "acted_by_name"> & {
  user_profiles?: { full_name: string | null } | null;
};

/**
 * The ledger names the person who acted, because "a named person reviewed it"
 * is half of what makes the record a survey artifact. A system transition has
 * no profile to embed and keeps a null here, which the surface renders as the
 * scheduled evaluation rather than as an unnamed person.
 */
function withActorName(row: RawDispositionRow): WatchlistDispositionRow {
  const { user_profiles: profile, ...rest } = row;
  return { ...rest, acted_by_name: profile?.full_name ?? null };
}

export interface WatchlistSignalHistoryRow {
  id: string;
  signal_key: string;
  severity_class: string;
  source_kind: string;
  status: string;
  first_detected_at: string;
  last_evaluated_at: string;
  cleared_at: string | null;
  cleared_reason: string | null;
  observed_count: number;
  evidence: Record<string, unknown> | null;
  disposition_note: string | null;
}

const PORTFOLIO_SELECT =
  "organization_id, facility_id, facility_name, residents_on_watchlist, open_signal_count, open_acute_signal_count, acute_resident_count, data_quality_signal_count, worst_band_key, worst_band_label, worst_band_rank, risk_index_latest, trend_direction";

const SIGNAL_SELECT =
  "organization_id, facility_id, facility_name, resident_id, resident_first_name, resident_last_name, resident_preferred_name, room_number, signal_instance_id, signal_key, signal_label, signal_description, severity_class, source_kind, status, first_detected_at, last_evaluated_at, observed_count, evidence, days_open, disposition_note, owner_user_id, owner_name, band_key, band_label, band_rank, open_signal_count";

const DISPOSITION_SELECT =
  "id, ledger_seq, signal_instance_id, signal_key, resident_id, from_status, to_status, note, actor_kind, acted_by, acted_by_role, acted_at, user_profiles!watchlist_signal_dispositions_acted_by_fkey(full_name)";

const HISTORY_SELECT =
  "id, signal_key, severity_class, source_kind, status, first_detected_at, last_evaluated_at, cleared_at, cleared_reason, observed_count, evidence, disposition_note";

/**
 * Ranked by band and then by age, which is spec section 7.5's ordering. Done in
 * SQL rather than in the client so a page that loads a subset still shows the
 * worst rows first.
 */
export async function fetchWatchlistPortfolio(
  supabase: SupabaseClient,
): Promise<WatchlistPortfolioRow[]> {
  const { data, error } = await supabase
    .from("v_watchlist_portfolio")
    .select(PORTFOLIO_SELECT)
    .order("open_acute_signal_count", { ascending: false })
    .order("facility_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as WatchlistPortfolioRow[];
}

export async function fetchFacilityWatchlist(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<WatchlistSignalRow[]> {
  const { data, error } = await supabase
    .from("v_watchlist_facility")
    .select(SIGNAL_SELECT)
    .eq("facility_id", facilityId)
    .order("band_rank", { ascending: false, nullsFirst: false })
    .order("first_detected_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as WatchlistSignalRow[];
}

export async function fetchResidentWatchlistSignals(
  supabase: SupabaseClient,
  residentId: string,
): Promise<WatchlistSignalHistoryRow[]> {
  const { data, error } = await supabase
    .from("watchlist_signal_instances")
    .select(HISTORY_SELECT)
    .eq("resident_id", residentId)
    .is("deleted_at", null)
    .order("first_detected_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WatchlistSignalHistoryRow[];
}

export async function fetchResidentDispositionLedger(
  supabase: SupabaseClient,
  residentId: string,
): Promise<WatchlistDispositionRow[]> {
  const { data, error } = await supabase
    .from("watchlist_signal_dispositions")
    .select(DISPOSITION_SELECT)
    .eq("resident_id", residentId)
    .order("ledger_seq", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as RawDispositionRow[]).map(withActorName);
}

export async function fetchFacilityDispositionLedger(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<WatchlistDispositionRow[]> {
  const { data, error } = await supabase
    .from("watchlist_signal_dispositions")
    .select(DISPOSITION_SELECT)
    .eq("facility_id", facilityId)
    .order("ledger_seq", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as RawDispositionRow[]).map(withActorName);
}

/**
 * Moves one signal forward. The command checks the caller's role, their reach
 * and the direction of travel, and the append only ledger row is written by a
 * trigger rather than by this call, so a client that forgot to write one cannot
 * produce a transition with no record behind it.
 */
export async function dispositionWatchlistSignal(
  supabase: SupabaseClient,
  args: { signalInstanceId: string; toStatus: string; note: string },
): Promise<void> {
  const { error } = await supabase.rpc("disposition_watchlist_signal", {
    p_instance_id: args.signalInstanceId,
    p_to_status: args.toStatus,
    p_note: args.note,
  });
  if (error) throw error;
}
