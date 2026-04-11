"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmergencyContactInput } from "@/lib/validation/facility-admin";

export interface EmergencyContactRow {
  id: string;
  contact_category: string;
  contact_name: string;
  phone_primary: string;
  phone_secondary: string | null;
  address: string | null;
  distance_miles: number | null;
  drive_time_minutes: number | null;
  account_number: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useFacilityEmergencyContacts(facilityId: string) {
  const [contacts, setContacts] = useState<EmergencyContactRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/emergency-contacts`);
      if (!res.ok) throw new Error("Failed to load emergency contacts");
      const json = (await res.json()) as { data: EmergencyContactRow[] };
      setContacts(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setContacts([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createContact = useCallback(
    async (payload: EmergencyContactInput) => {
      const res = await fetch(`/api/admin/facilities/${facilityId}/emergency-contacts`, {
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

  return { contacts, isLoading, error, refetch, createContact };
}
