"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import {
  FACILITIES_LIST_QUERY_KEY,
  facilitiesListQueryKey,
  fetchFacilitiesList,
  type FetchFacilitiesListParams,
} from "@/lib/admin/facilities/fetch-facilities-list";
import type { FacilityRow } from "@/types/facility";

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

const FACILITIES_LIST_STALE_MS = 60_000;

let facilitiesQueryClient: QueryClient | null = null;

/**
 * Clear cached facility list reads. Call after any facility mutation
 * (create / edit / archive) so the next list read reflects the change.
 */
export function invalidateFacilitiesCache(): void {
  void facilitiesQueryClient?.invalidateQueries({ queryKey: FACILITIES_LIST_QUERY_KEY });
}

export function useFacilities(options: FetchFacilitiesListParams = {}): UseFacilitiesReturn {
  const { status, search, page = 1, pageSize = 20 } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    facilitiesQueryClient = queryClient;
  }, [queryClient]);

  const {
    data,
    isPending,
    error: queryError,
    refetch: refetchQuery,
  } = useQuery({
    queryKey: facilitiesListQueryKey({ status, search, page, pageSize }),
    queryFn: () => fetchFacilitiesList({ status, search, page, pageSize }),
    staleTime: FACILITIES_LIST_STALE_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  return {
    facilities: data?.facilities ?? [],
    isLoading: isPending && !data,
    error: queryError instanceof Error ? queryError.message : queryError ? "Failed to fetch facilities" : null,
    pagination:
      data?.pagination ?? {
        total: 0,
        page: 1,
        page_size: pageSize,
        total_pages: 0,
        has_next: false,
      },
    refetch,
  };
}
