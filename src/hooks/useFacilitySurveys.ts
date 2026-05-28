"use client";

import { useCallback, useEffect, useState } from "react";
import type { SurveyHistoryInput } from "@/lib/validation/facility-admin";
import { lruGet, lruSet } from "@/hooks/internal/lru-cache";

export interface SurveyRow {
  id: string;
  survey_date: string;
  survey_type: string;
  result: string;
  citation_count: number;
  citation_details: unknown;
  poc_submitted_date: string | null;
  poc_accepted_date: string | null;
  surveyor_names: string[] | null;
  document_id: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

type SurveysCacheEntry = { surveys: SurveyRow[]; fetchedAt: number };
const surveysCache = new Map<string, SurveysCacheEntry>();
const SURVEYS_CACHE_TTL_MS = 60_000;
const SURVEYS_CACHE_MAX = 16;

export function useFacilitySurveys(facilityId: string) {
  const cached = lruGet(surveysCache, facilityId);
  const cacheIsFresh = cached != null && Date.now() - cached.fetchedAt < SURVEYS_CACHE_TTL_MS;

  const [surveys, setSurveys] = useState<SurveyRow[]>(cached?.surveys ?? []);
  const [isLoading, setIsLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const hasCached = surveysCache.has(facilityId);
    if (!hasCached) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/surveys`);
      if (!res.ok) throw new Error("Failed to load surveys");
      const json = (await res.json()) as { data: SurveyRow[] };
      const next = json.data ?? [];
      setSurveys(next);
      lruSet(surveysCache, facilityId, { surveys: next, fetchedAt: Date.now() }, SURVEYS_CACHE_MAX);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!hasCached) setSurveys([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (cacheIsFresh) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

  const createSurvey = useCallback(
    async (payload: SurveyHistoryInput) => {
      const res = await fetch(`/api/admin/facilities/${facilityId}/surveys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Create failed");
      }
      surveysCache.delete(facilityId);
      await refetch();
    },
    [facilityId, refetch],
  );

  return { surveys, isLoading, error, refetch, createSurvey };
}
