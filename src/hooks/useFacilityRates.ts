"use client";

import { useState, useCallback, useEffect } from "react";
import { RATE_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";

interface RateEntry {
  id: string;
  facility_id: string;
  rate_type: string;
  rate_type_label: string;
  amount_cents: number;
  amount_usd: number;
  effective_from: string;
  effective_to: string | null;
  rate_confirmed: boolean;
  created_at: string;
  approved_by?: string | null;
}

interface RatesResponse {
  data: RateEntry[];
}

interface CreateRatePayload {
  rate_type: string;
  amount_cents: number;
  effective_from: string;
  notes?: string;
  rate_confirmed?: boolean;
}

interface UseFacilityRatesReturn {
  rates: RateEntry[];
  isLoading: boolean;
  error: string | null;
  createRate: (payload: CreateRatePayload) => Promise<RateEntry | null>;
  isCreating: boolean;
  refetch: () => Promise<void>;
  confirmRate: (rateId: string) => Promise<boolean>;
  isConfirming: boolean;
}

export function useFacilityRates(facilityId: string): UseFacilityRatesReturn {
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/rates`);
      if (!res.ok) {
        throw new Error("Failed to fetch rates");
      }
      const json = (await res.json()) as RatesResponse;
      setRates(
        (json.data ?? []).map((rate) => ({
          ...rate,
          effective_to: rate.effective_to ?? null,
          rate_confirmed: Boolean(rate.rate_confirmed),
          rate_type_label:
            RATE_TYPE_LABELS[rate.rate_type as keyof typeof RATE_TYPE_LABELS] ?? rate.rate_type,
          amount_usd: rate.amount_cents / 100,
        })),
      );
    } catch (err) {
      console.error("[useFacilityRates] fetch error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch rates";
      setError(message);
      setRates([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  const confirmRate = useCallback(
    async (rateId: string): Promise<boolean> => {
      setIsConfirming(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/rates/${rateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rate_confirmed: true }),
        });
        if (!res.ok) throw new Error("Failed to confirm rate");
        await refetch();
        return true;
      } catch (err) {
        console.error("[useFacilityRates] confirm error:", err);
        const message = err instanceof Error ? err.message : "Failed to confirm rate";
        setError(message);
        return false;
      } finally {
        setIsConfirming(false);
      }
    },
    [facilityId, refetch],
  );

  const createRate = useCallback(
    async (payload: CreateRatePayload): Promise<RateEntry | null> => {
      setIsCreating(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/rates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error("Failed to create rate");
        }
        const json = (await res.json()) as { data: RateEntry };
        await refetch();
        return json.data;
      } catch (err) {
        console.error("[useFacilityRates] create error:", err);
        const message = err instanceof Error ? err.message : "Failed to create rate";
        setError(message);
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [facilityId, refetch],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    rates,
    isLoading,
    error,
    createRate,
    isCreating,
    refetch,
    confirmRate,
    isConfirming,
  };
}
