"use client";

import { useCallback, useEffect, useState } from "react";
import type { TimelineEventInput } from "@/lib/validation/facility-admin";

export interface TimelineEventRow {
  id: string;
  event_date: string;
  event_type: string;
  title: string;
  description: string | null;
  document_id: string | null;
  created_at: string;
  created_by: string | null;
}

export function useFacilityTimeline(facilityId: string) {
  const [events, setEvents] = useState<TimelineEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/timeline`);
      if (!res.ok) throw new Error("Failed to load timeline");
      const json = (await res.json()) as { data: TimelineEventRow[] };
      setEvents(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createEvent = useCallback(
    async (payload: TimelineEventInput) => {
      const res = await fetch(`/api/admin/facilities/${facilityId}/timeline`, {
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

  return { events, isLoading, error, refetch, createEvent };
}
