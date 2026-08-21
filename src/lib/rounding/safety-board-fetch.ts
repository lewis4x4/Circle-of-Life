import type { SupabaseClient } from "@supabase/supabase-js";

import { queryErrorMessage } from "@/lib/supabase/query-error";

export type SafetyBoardRiskTier = "low" | "moderate" | "high" | "critical";

export type SafetyBoardScoreRow = {
  id: string;
  resident_id: string;
  facility_id: string;
  score: number;
  risk_tier: SafetyBoardRiskTier;
  component_scores: Record<string, number>;
  previous_score: number | null;
  score_delta: number | null;
  computed_at: string;
  residents?: { first_name: string; last_name: string; room_number: string | null } | null;
  facilities?: { name: string } | null;
};

export const SAFETY_BOARD_SCORE_SELECT_WITH_EMBED =
  "*, residents(first_name, last_name, beds!residents_bed_id_fkey(rooms(room_number))), facilities(name)";

export const SAFETY_BOARD_SCORE_SELECT_CORE =
  "id, resident_id, facility_id, score, risk_tier, component_scores, previous_score, score_delta, computed_at";

type ResidentEmbed = {
  first_name: string;
  last_name: string;
  beds?: { rooms?: { room_number: string | null } | null } | null;
};

type RawScoreRow = Omit<SafetyBoardScoreRow, "residents"> & {
  residents?: ResidentEmbed | null;
};

export type SafetyBoardFetchOutcome =
  | { kind: "success"; rows: SafetyBoardScoreRow[] }
  | { kind: "unexpected_error"; error: unknown };

/** Embed/column/relation failures should not crash the board — fall back to core scores. */
export function isSafetyBoardRecoverableFetchError(error: unknown): boolean {
  const message = queryErrorMessage(error).toLowerCase();
  if (!message) return false;

  if (message.includes("resident_safety_scores") && message.includes("permission denied")) {
    return false;
  }

  return (
    message.includes("room_number") ||
    message.includes("does not exist") ||
    message.includes("could not find a relationship") ||
    message.includes("pgrst200") ||
    message.includes("schema cache") ||
    (message.includes("permission denied") && !message.includes("resident_safety_scores"))
  );
}

export function normalizeSafetyBoardScoreRow(row: RawScoreRow): SafetyBoardScoreRow {
  const residents = row.residents;
  return {
    ...row,
    residents: residents
      ? {
          first_name: residents.first_name,
          last_name: residents.last_name,
          room_number: residents.beds?.rooms?.room_number ?? null,
        }
      : null,
  };
}

type ScoreQueryResult = { data: RawScoreRow[] | null; error: unknown };

async function runScoreQuery(
  supabase: SupabaseClient,
  select: string,
  organizationId: string,
  facilityId: string,
): Promise<ScoreQueryResult> {
  const { data, error } = await supabase
    .from("resident_safety_scores")
    .select(select)
    .eq("organization_id", organizationId)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("score", { ascending: true })
    .limit(200);

  if (error) return { data: null, error };
  return { data: (data ?? []) as unknown as RawScoreRow[], error: null };
}

export async function fetchSafetyBoardScores(
  supabase: SupabaseClient,
  options: { organizationId: string; facilityId: string },
): Promise<SafetyBoardFetchOutcome> {
  const primary = await runScoreQuery(
    supabase,
    SAFETY_BOARD_SCORE_SELECT_WITH_EMBED,
    options.organizationId,
    options.facilityId,
  );

  if (!primary.error) {
    return {
      kind: "success",
      rows: (primary.data ?? []).map(normalizeSafetyBoardScoreRow),
    };
  }

  if (!isSafetyBoardRecoverableFetchError(primary.error)) {
    return { kind: "unexpected_error", error: primary.error };
  }

  const fallback = await runScoreQuery(
    supabase,
    SAFETY_BOARD_SCORE_SELECT_CORE,
    options.organizationId,
    options.facilityId,
  );

  if (!fallback.error) {
    return {
      kind: "success",
      rows: (fallback.data ?? []).map((row) =>
        normalizeSafetyBoardScoreRow({ ...row, residents: null, facilities: null }),
      ),
    };
  }

  if (isSafetyBoardRecoverableFetchError(fallback.error)) {
    return { kind: "success", rows: [] };
  }

  return { kind: "unexpected_error", error: fallback.error };
}
