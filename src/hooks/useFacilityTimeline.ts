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

type TimelineCacheEntry = { events: TimelineEventRow[]; fetchedAt: number };
const timelineCache = new Map<string, TimelineCacheEntry>();
const TIMELINE_CACHE_TTL_MS = 60_000;

export function useFacilityTimeline(facilityId: string) {
  const cached = timelineCache.get(facilityId);
  const cacheIsFresh = cached != null && Date.now() - cached.fetchedAt < TIMELINE_CACHE_TTL_MS;

  const [events, setEvents] = useState<TimelineEventRow[]>(cached?.events ?? []);
  const [isLoading, setIsLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const hasCached = timelineCache.has(facilityId);
    if (!hasCached) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/timeline`);
      if (!res.ok) throw new Error("Failed to load timeline");
      const json = (await res.json()) as { data: TimelineEventRow[] };
      const next = json.data ?? [];
      setEvents(next);
      timelineCache.set(facilityId, { events: next, fetchedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!hasCached) setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (cacheIsFresh) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      timelineCache.delete(facilityId);
      await refetch();
    },
    [facilityId, refetch],
  );

  return { events, isLoading, error, refetch, createEvent };
}
