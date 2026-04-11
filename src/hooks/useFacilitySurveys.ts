"use client";

import { useCallback, useEffect, useState } from "react";
import type { SurveyHistoryInput } from "@/lib/validation/facility-admin";

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

export function useFacilitySurveys(facilityId: string) {
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/surveys`);
      if (!res.ok) throw new Error("Failed to load surveys");
      const json = (await res.json()) as { data: SurveyRow[] };
      setSurveys(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setSurveys([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
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
      await refetch();
    },
    [facilityId, refetch],
  );

  return { surveys, isLoading, error, refetch, createSurvey };
}
