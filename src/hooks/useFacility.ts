"use client";

import { useState, useCallback, useEffect } from "react";
import type { FacilityRow } from "@/types/facility";

interface UseFacilityReturn {
  facility: FacilityRow | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateFacility: (updates: Partial<FacilityRow>) => Promise<FacilityRow | null>;
  isUpdating: boolean;
}

export function useFacility(facilityId: string): UseFacilityReturn {
  const [facility, setFacility] = useState<FacilityRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch facility");
      }
      const json = (await res.json()) as { data: FacilityRow };
      setFacility(json.data);
    } catch (err) {
      console.error("[useFacility] fetch error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch facility";
      setError(message);
      setFacility(null);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  const updateFacility = useCallback(
    async (updates: Partial<FacilityRow>): Promise<FacilityRow | null> => {
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
        const json = (await res.json()) as { data: FacilityRow };
        setFacility(json.data);
        return json.data;
      } catch (err) {
        console.error("[useFacility] update error:", err);
        const message = err instanceof Error ? err.message : "Failed to update facility";
        setError(message);
        return null;
      } finally {
        setIsUpdating(false);
      }
    },
    [facilityId],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    facility,
    isLoading,
    error,
    refetch,
    updateFacility,
    isUpdating,
  };
}
