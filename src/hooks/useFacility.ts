"use client";

import { useState, useCallback, useEffect } from "react";
import type { FacilityDetailRow, FacilityRow } from "@/types/facility";
import { useFacilityStore } from "@/hooks/useFacilityStore";

function normalizeFacilityDetail(raw: Record<string, unknown>): FacilityDetailRow {
  const f = raw as unknown as FacilityDetailRow & { license_number?: string | null };
  const entity = f.entity ?? null;
  const entityName =
    f.entity_name ??
    entity?.legal_name ??
    entity?.dba_name ??
    null;
  const occ = f.occupancy_count ?? f.current_occupancy ?? 0;
  const beds = f.total_beds ?? f.licensed_beds ?? f.total_licensed_beds ?? 0;

  const openRaw = raw["open_survey_deficiencies_count"];
  const openSurveyDeficiencies =
    typeof openRaw === "number" && Number.isFinite(openRaw) ? openRaw : f.open_survey_deficiencies_count;

  const profileSaver = raw["profile_last_saved_by_full_name"];
  const profileResolved =
    typeof profileSaver === "string" ? profileSaver : (f.profile_last_saved_by_full_name ?? null);

  return {
    ...f,
    entity_name: entityName,
    current_occupancy: occ,
    licensed_beds: beds,
    ahca_license_number: f.ahca_license_number ?? f.license_number ?? null,
    open_survey_deficiencies_count: openSurveyDeficiencies,
    profile_last_saved_by_full_name: profileResolved,
  } as FacilityDetailRow;
}

interface UseFacilityReturn {
  facility: FacilityDetailRow | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateFacility: (updates: Partial<FacilityRow>) => Promise<FacilityDetailRow | null>;
  isUpdating: boolean;
}

// 60s in-memory cache keyed by facilityId so tab switches and remounts
// repaint instantly. Mutations bust the entry via cacheBust.
type FacilityCacheEntry = { facility: FacilityDetailRow; fetchedAt: number };
const facilityCache = new Map<string, FacilityCacheEntry>();
const FACILITY_CACHE_TTL_MS = 60_000;

export function useFacility(facilityId: string): UseFacilityReturn {
  const cached = facilityCache.get(facilityId);
  const cacheIsFresh = cached != null && Date.now() - cached.fetchedAt < FACILITY_CACHE_TTL_MS;

  const [facility, setFacility] = useState<FacilityDetailRow | null>(cached?.facility ?? null);
  const [isLoading, setIsLoading] = useState(cached == null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (showLoading: boolean): Promise<FacilityDetailRow | null> => {
      const hasCached = facilityCache.has(facilityId);
      if (showLoading && !hasCached) setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}`);
        const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
        if (!res.ok) {
          const msg =
            typeof json.error === "string" && json.error.length > 0
              ? json.error
              : `Could not load facility (${res.status})`;
          throw new Error(msg);
        }
        if (!json.data) {
          throw new Error("Invalid response from facility API");
        }
        const n = normalizeFacilityDetail(json.data);
        setFacility(n);
        facilityCache.set(facilityId, { facility: n, fetchedAt: Date.now() });
        return n;
      } catch (err) {
        console.error("[useFacility] fetch error:", err);
        const message = err instanceof Error ? err.message : "Failed to fetch facility";
        setError(message);
        if (!hasCached) setFacility(null);
        return null;
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [facilityId],
  );

  const refetch = useCallback(async () => {
    await loadDetail(true);
  }, [loadDetail]);

  const clearFacilityListCache = useFacilityStore((s) => s.clearFacilityCache);

  const updateFacility = useCallback(
    async (updates: Partial<FacilityRow>): Promise<FacilityDetailRow | null> => {
      setIsUpdating(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          throw new Error("Failed to update facility");
        }
        // Bust both caches so the next reads — detail and facility-list
        // dropdowns — pick up the rename / status change without waiting
        // out the 60s / 5min TTLs.
        facilityCache.delete(facilityId);
        clearFacilityListCache();
        return await loadDetail(false);
      } catch (err) {
        console.error("[useFacility] update error:", err);
        const message = err instanceof Error ? err.message : "Failed to update facility";
        setError(message);
        return null;
      } finally {
        setIsUpdating(false);
      }
    },
    [facilityId, loadDetail, clearFacilityListCache],
  );

  useEffect(() => {
    if (cacheIsFresh) return;
    void loadDetail(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDetail]);

  return {
    facility,
    isLoading,
    error,
    refetch,
    updateFacility,
    isUpdating,
  };
}
