"use client";

import { useCallback, useEffect, useState } from "react";

import type { FacilityDataHealth } from "@/lib/facility-checks/data-health";
import { createClient } from "@/lib/supabase/client";

/**
 * Live anomaly counts for one facility (COL-361). Read only. The function is
 * `security invoker` for the bed and resident numbers and delegates the three
 * identity counts to a definer reader that does its own grant check, so a
 * caller never sees more here than they are entitled to.
 */
export function useFacilityDataHealth(
  facilityId: string,
  enabled = true,
): { data: FacilityDataHealth | null; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const [data, setData] = useState<FacilityDataHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !facilityId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: rows, error: queryError } = await supabase.rpc("facility_data_health", {
        p_facility_id: facilityId,
      });
      if (queryError) throw queryError;
      setData((rows?.[0] as FacilityDataHealth | undefined) ?? null);
    } catch {
      // The panel says so in its own words; the raw message stays in the client.
      setError("unavailable");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
