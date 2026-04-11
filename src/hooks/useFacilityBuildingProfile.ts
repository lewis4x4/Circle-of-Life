"use client";

import { useCallback, useEffect, useState } from "react";
import type { BuildingProfileInput } from "@/lib/validation/facility-admin";

export function useFacilityBuildingProfile(facilityId: string) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/building-profile`);
      if (!res.ok) throw new Error("Failed to load building profile");
      const json = (await res.json()) as { data: Record<string, unknown> | null };
      setProfile(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveProfile = useCallback(
    async (payload: BuildingProfileInput) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/building-profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Save failed");
        }
        const json = (await res.json()) as { data: Record<string, unknown> };
        setProfile(json.data);
      } finally {
        setIsSaving(false);
      }
    },
    [facilityId],
  );

  return { profile, isLoading, error, refetch, saveProfile, isSaving };
}
