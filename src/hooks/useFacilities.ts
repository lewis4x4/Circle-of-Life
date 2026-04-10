"use client";

import { useState, useCallback, useEffect } from "react";
import type { FacilityRow } from "@/types/facility";

interface FacilitiesResponse {
  facilities: FacilityRow[];
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

export function useFacilities(options: UseFacilitiesOptions = {}): UseFacilitiesReturn {
  const { status, search, page = 1, pageSize = 20 } = options;

  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    page_size: 20,
    total_pages: 0,
    has_next: false,
  });

  const refetch = useCallback(async () => {
    setIsLoading(true);
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
      setFacilities(json.facilities ?? []);
      setPagination({
        total: json.total ?? 0,
        page: json.page ?? page,
        page_size: pageSize,
        total_pages: Math.ceil((json.total ?? 0) / pageSize),
        has_next: json.has_next ?? false,
      });
    } catch (err) {
      console.error("[useFacilities] error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch facilities";
      setError(message);
      setFacilities([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, status, search]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    facilities,
    isLoading,
    error,
    pagination,
    refetch,
  };
}
