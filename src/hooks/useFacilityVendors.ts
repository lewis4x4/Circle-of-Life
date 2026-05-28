"use client";

import { useCallback, useEffect, useState } from "react";
import { lruGet, lruSet } from "@/hooks/internal/lru-cache";

export interface VendorFacilityRow {
  id: string;
  vendor_id: string | null;
  is_primary: boolean;
  created_at: string;
  source?: string;
  coi_on_file?: boolean | null;
  coi_expiration?: string | null;
  service_contract_status?: string | null;
  service_contract_expiration?: string | null;
  last_invoice_at?: string | null;
  last_payment_at?: string | null;
  vendor: {
    id: string;
    name: string;
    category: string;
    status: string;
    primary_contact_name: string | null;
    primary_contact_phone: string | null;
    primary_contact_email: string | null;
    notes: string | null;
  } | null;
}

export type FacilityVendorFacilityKpi = {
  canonical_vendor_count: number;
  migration_residue_count: number;
};

type VendorsCacheEntry = {
  rows: VendorFacilityRow[];
  kpi: FacilityVendorFacilityKpi | null;
  fetchedAt: number;
};
const vendorsCache = new Map<string, VendorsCacheEntry>();
const VENDORS_CACHE_TTL_MS = 60_000;
const VENDORS_CACHE_MAX = 16;

export function useFacilityVendors(facilityId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const cached = lruGet(vendorsCache, facilityId);
  const cacheIsFresh = cached != null && Date.now() - cached.fetchedAt < VENDORS_CACHE_TTL_MS;

  const [rows, setRows] = useState<VendorFacilityRow[]>(cached?.rows ?? []);
  const [kpi, setKpi] = useState<FacilityVendorFacilityKpi | null>(cached?.kpi ?? null);
  const [isLoading, setIsLoading] = useState(enabled && cached == null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const hasCached = vendorsCache.has(facilityId);
    if (!hasCached) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/vendors`);
      if (!res.ok) throw new Error("Failed to load vendors");
      const json = (await res.json()) as {
        data: VendorFacilityRow[];
        kpi?: FacilityVendorFacilityKpi;
      };
      const nextRows = json.data ?? [];
      const nextKpi = json.kpi ?? null;
      setRows(nextRows);
      setKpi(nextKpi);
      lruSet(
        vendorsCache,
        facilityId,
        { rows: nextRows, kpi: nextKpi, fetchedAt: Date.now() },
        VENDORS_CACHE_MAX,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!hasCached) {
        setRows([]);
        setKpi(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setKpi(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (cacheIsFresh) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refetch]);

  return { rows, kpi, isLoading, error, refetch };
}
