"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommunicationSettingsInput } from "@/lib/validation/facility-admin";

export function useFacilityCommunicationSettings(facilityId: string) {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [capabilities, setCapabilities] = useState<{
    can_edit: boolean;
    can_edit_marketing: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/communication-settings`);
      if (!res.ok) throw new Error("Failed to load communication settings");
      const json = (await res.json()) as {
        data: Record<string, unknown> | null;
        capabilities?: { can_edit: boolean; can_edit_marketing: boolean };
      };
      setSettings(json.data);
      setCapabilities(
        json.capabilities ?? { can_edit: false, can_edit_marketing: false },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setSettings(null);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveSettings = useCallback(
    async (payload: CommunicationSettingsInput) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/communication-settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Save failed");
        }
        await refetch();
      } finally {
        setIsSaving(false);
      }
    },
    [facilityId, refetch],
  );

  return { settings, capabilities, isLoading, error, refetch, saveSettings, isSaving };
}
