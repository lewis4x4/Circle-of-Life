"use client";

import { useState, useCallback, useEffect } from "react";
import type { FacilityRow } from "@/types/facility";

function normalizeListRow(raw: Record<string, unknown>): FacilityRow {
  type ListApi = FacilityRow & {
    occupancy_count?: number;
    total_beds?: number;
    occupancy_pct?: number;
    administrator_staff_id?: string | null;
    survey_readiness_pct?: number | null;
    portfolio_open_incidents_total?: number;
    portfolio_open_incidents_level_3?: number;
    labor_cost_mtd_pct?: number | null;
    last_survey_date?: string | null;
    last_survey_result?: string | null;
    total_licensed_beds?: number;
    administrator_name?: string | null;
  };

  const f = raw as unknown as ListApi;
  const occ = typeof f.occupancy_count === "number" ? f.occupancy_count : 0;
  const licensedCapacity = typeof f.total_licensed_beds === "number" ? f.total_licensed_beds : 0;

  let occupancy_pct_norm: number | null = null;
  if (typeof f.occupancy_pct === "number" && Number.isFinite(f.occupancy_pct)) {
    occupancy_pct_norm =
      f.occupancy_pct <= 1 ? f.occupancy_pct : Math.min(1, Math.max(0, f.occupancy_pct / 100));
  }

  return {
    ...(f as unknown as FacilityRow),
    current_occupancy: occ,
    licensed_beds: licensedCapacity,
    occupancy_pct: occupancy_pct_norm,
    administrator_staff_id: f.administrator_staff_id ?? null,
    survey_readiness_pct:
      typeof f.survey_readiness_pct === "number" && Number.isFinite(f.survey_readiness_pct)
        ? f.survey_readiness_pct
        : null,
    portfolio_open_incidents_total:
      typeof f.portfolio_open_incidents_total === "number" ? f.portfolio_open_incidents_total : 0,
    portfolio_open_incidents_level_3:
      typeof f.portfolio_open_incidents_level_3 === "number" ? f.portfolio_open_incidents_level_3 : 0,
    labor_cost_mtd_pct:
      typeof f.labor_cost_mtd_pct === "number" && Number.isFinite(f.labor_cost_mtd_pct)
        ? f.labor_cost_mtd_pct
        : null,
    last_survey_date: f.last_survey_date ?? null,
    last_survey_result: f.last_survey_result ?? null,
    administrator_name: f.administrator_name ?? null,
  } as FacilityRow;
}

interface FacilitiesResponse {
  facilities: Record<string, unknown>[];
  total: number;
  page: number;
  has_next: boolean;
}

interface UseFacilitiesOptions {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface UseFacilitiesReturn {
  facilities: FacilityRow[];
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    has_next: boolean;
  };
  refetch: () => Promise<void>;
}

// Module-level cache survives client-side navigations within a session.
// Keyed by query params; ~60s freshness window then stale-while-revalidate.
type CacheEntry = {
  facilities: FacilityRow[];
  pagination: UseFacilitiesReturn["pagination"];
  fetchedAt: number;
};
const facilitiesCache = new Map<string, CacheEntry>();
const FACILITIES_CACHE_TTL_MS = 60_000;

export function useFacilities(options: UseFacilitiesOptions = {}): UseFacilitiesReturn {
  const { status, search, page = 1, pageSize = 20 } = options;

  const cacheKey = `${page}|${pageSize}|${status ?? ""}|${search ?? ""}`;
  const cached = facilitiesCache.get(cacheKey);
  const cacheIsFresh = cached != null && Date.now() - cached.fetchedAt < FACILITIES_CACHE_TTL_MS;

  const [facilities, setFacilities] = useState<FacilityRow[]>(cached?.facilities ?? []);
  // Only show the full-page spinner when we have nothing to paint.
  const [isLoading, setIsLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState(
    cached?.pagination ?? {
      total: 0,
      page: 1,
      page_size: 20,
      total_pages: 0,
      has_next: false,
    },
  );

  const refetch = useCallback(async () => {
    const hasCached = facilitiesCache.has(cacheKey);
    if (!hasCached) setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (status) params.set("status", status);
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/facilities?${params}`);
      if (!res.ok) {
        throw new Error("Failed to fetch facilities");
      }
      const json = (await res.json()) as FacilitiesResponse;
      const normalized = (json.facilities ?? []).map((row) => normalizeListRow(row));
      const nextPagination = {
        total: json.total ?? 0,
        page: json.page ?? page,
        page_size: pageSize,
        total_pages: Math.ceil((json.total ?? 0) / pageSize),
        has_next: json.has_next ?? false,
      };
      setFacilities(normalized);
      setPagination(nextPagination);
      facilitiesCache.set(cacheKey, {
        facilities: normalized,
        pagination: nextPagination,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      console.error("[useFacilities] error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch facilities";
      setError(message);
      if (!hasCached) setFacilities([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, status, search, cacheKey]);

  useEffect(() => {
    // If we have a fresh cache hit, skip the network round-trip entirely.
    if (cacheIsFresh) return;
    void refetch();
    // refetch is stable for this query shape; cacheIsFresh is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

  return {
    facilities,
    isLoading,
    error,
    pagination,
    refetch,
  };
}
