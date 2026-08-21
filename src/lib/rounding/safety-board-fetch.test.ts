import { describe, expect, it, vi } from "vitest";

import {
  fetchSafetyBoardScores,
  isSafetyBoardRecoverableFetchError,
  normalizeSafetyBoardScoreRow,
  SAFETY_BOARD_SCORE_SELECT_CORE,
  SAFETY_BOARD_SCORE_SELECT_WITH_EMBED,
} from "./safety-board-fetch";

describe("isSafetyBoardRecoverableFetchError", () => {
  it("treats invalid resident embed columns as recoverable", () => {
    expect(
      isSafetyBoardRecoverableFetchError({
        message: "column residents.room_number does not exist",
      }),
    ).toBe(true);
  });

  it("treats missing relationship embeds as recoverable", () => {
    expect(
      isSafetyBoardRecoverableFetchError({
        message: "Could not find a relationship between 'resident_safety_scores' and 'residents'",
      }),
    ).toBe(true);
  });

  it("keeps resident_safety_scores permission denied as unexpected", () => {
    expect(
      isSafetyBoardRecoverableFetchError({
        message: "permission denied for table resident_safety_scores",
      }),
    ).toBe(false);
  });
});

describe("normalizeSafetyBoardScoreRow", () => {
  it("maps nested bed room numbers onto the board row shape", () => {
    expect(
      normalizeSafetyBoardScoreRow({
        id: "score-anon-1",
        resident_id: "res-anon-1",
        facility_id: "fac-anon-1",
        score: 42,
        risk_tier: "moderate",
        component_scores: {},
        previous_score: null,
        score_delta: null,
        computed_at: "2026-08-21T12:00:00.000Z",
        residents: {
          first_name: "Resident",
          last_name: "One",
          beds: { rooms: { room_number: "101" } },
        },
      }),
    ).toEqual({
      id: "score-anon-1",
      resident_id: "res-anon-1",
      facility_id: "fac-anon-1",
      score: 42,
      risk_tier: "moderate",
      component_scores: {},
      previous_score: null,
      score_delta: null,
      computed_at: "2026-08-21T12:00:00.000Z",
      residents: {
        first_name: "Resident",
        last_name: "One",
        room_number: "101",
      },
    });
  });
});

describe("fetchSafetyBoardScores", () => {
  function buildSupabase(responses: Record<string, ScoreQueryResult>) {
    return {
      from: vi.fn(() => ({
        select: vi.fn((select: string) => {
          const chain = {
            eq: vi.fn(() => chain),
            is: vi.fn(() => chain),
            order: vi.fn(() => chain),
            limit: vi.fn(async () => responses[select] ?? { data: [], error: null }),
          };
          return chain;
        }),
      })),
    };
  }

  type ScoreQueryResult = { data: unknown[] | null; error: { message: string } | null };

  it("returns empty rows when the embed query succeeds with zero rows", async () => {
    const supabase = buildSupabase({
      [SAFETY_BOARD_SCORE_SELECT_WITH_EMBED]: { data: [], error: null },
    });

    const outcome = await fetchSafetyBoardScores(supabase as never, {
      organizationId: "org-anon-1",
      facilityId: "fac-anon-1",
    });

    expect(outcome).toEqual({ kind: "success", rows: [] });
  });

  it("falls back to core scores when the embed query fails", async () => {
    const supabase = buildSupabase({
      [SAFETY_BOARD_SCORE_SELECT_WITH_EMBED]: {
        data: null,
        error: { message: "column residents.room_number does not exist" },
      },
      [SAFETY_BOARD_SCORE_SELECT_CORE]: {
        data: [
          {
            id: "score-anon-1",
            resident_id: "res-anon-1",
            facility_id: "fac-anon-1",
            score: 55,
            risk_tier: "low",
            component_scores: {},
            previous_score: null,
            score_delta: null,
            computed_at: "2026-08-21T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const outcome = await fetchSafetyBoardScores(supabase as never, {
      organizationId: "org-anon-1",
      facilityId: "fac-anon-1",
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.rows).toHaveLength(1);
      expect(outcome.rows[0]?.residents).toBeNull();
    }
  });

  it("returns empty rows when recoverable errors persist on fallback", async () => {
    const supabase = buildSupabase({
      [SAFETY_BOARD_SCORE_SELECT_WITH_EMBED]: {
        data: null,
        error: { message: "Could not find a relationship between 'resident_safety_scores' and 'residents'" },
      },
      [SAFETY_BOARD_SCORE_SELECT_CORE]: {
        data: null,
        error: { message: "permission denied for table residents" },
      },
    });

    const outcome = await fetchSafetyBoardScores(supabase as never, {
      organizationId: "org-anon-1",
      facilityId: "fac-anon-1",
    });

    expect(outcome).toEqual({ kind: "success", rows: [] });
  });

  it("surfaces unexpected fetch failures", async () => {
    const unexpected = { message: "permission denied for table resident_safety_scores" };
    const supabase = buildSupabase({
      [SAFETY_BOARD_SCORE_SELECT_WITH_EMBED]: { data: null, error: unexpected },
    });

    const outcome = await fetchSafetyBoardScores(supabase as never, {
      organizationId: "org-anon-1",
      facilityId: "fac-anon-1",
    });

    expect(outcome).toEqual({ kind: "unexpected_error", error: unexpected });
  });
});
