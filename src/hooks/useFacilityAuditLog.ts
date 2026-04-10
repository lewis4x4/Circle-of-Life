"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { UUID_STRING_RE } from "@/lib/supabase/env";

interface AuditEntry {
  id: string;
  facility_id: string;
  timestamp: string;
  user: string;
  table_name: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
}

interface AuditLogResponse {
  data: AuditEntry[];
  pagination: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    has_next: boolean;
  };
}

interface AuditLogFilters {
  fieldName?: string;
  user?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

interface UseFacilityAuditLogReturn {
  entries: AuditEntry[];
  isLoading: boolean;
  error: string | null;
  total: number;
  page: number;
  hasNext: boolean;
  refetch: (filters?: AuditLogFilters) => Promise<void>;
}

const EMPTY_FILTERS: AuditLogFilters = {};

export function useFacilityAuditLog(facilityId: string, initialFilters: AuditLogFilters = {}): UseFacilityAuditLogReturn {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialFilters.page ?? 1);
  const [hasNext, setHasNext] = useState(false);
  const initialFiltersRef = useRef<AuditLogFilters>(initialFilters ?? EMPTY_FILTERS);

  const refetch = useCallback(
    async (filters: AuditLogFilters = {}) => {
      setIsLoading(true);
      setError(null);
      const { fieldName, user, startDate, endDate, page: newPage = 1, pageSize = 20 } = filters;
      setPage(newPage);

      try {
        const params = new URLSearchParams({
          page: newPage.toString(),
          per_page: pageSize.toString(),
        });
        if (fieldName) params.set("field_name", fieldName);
        if (user && UUID_STRING_RE.test(user)) params.set("user_id", user);
        if (startDate) params.set("from", startDate);
        if (endDate) params.set("to", endDate);

        const res = await fetch(`/api/admin/facilities/${facilityId}/audit-log?${params}`);
        if (!res.ok) {
          throw new Error("Failed to fetch audit log");
        }
        const json = (await res.json()) as AuditLogResponse;
        setEntries(
          (json.data ?? []).map((entry) => ({
            ...entry,
            timestamp: (entry as AuditEntry & { changed_at?: string }).changed_at ?? entry.timestamp,
            user: (entry as AuditEntry & { changed_by?: string }).changed_by ?? entry.user,
          })),
        );
        setTotal(json.pagination?.total ?? 0);
        setHasNext(json.pagination?.has_next ?? false);
      } catch (err) {
        console.error("[useFacilityAuditLog] fetch error:", err);
        const message = err instanceof Error ? err.message : "Failed to fetch audit log";
        setError(message);
        setEntries([]);
        setTotal(0);
        setHasNext(false);
      } finally {
        setIsLoading(false);
      }
    },
    [facilityId],
  );

  useEffect(() => {
    initialFiltersRef.current = initialFilters ?? EMPTY_FILTERS;
  }, [initialFilters]);

  useEffect(() => {
    void refetch(initialFiltersRef.current);
  }, [refetch]);

  return {
    entries,
    isLoading,
    error,
    total,
    page,
    hasNext,
    refetch,
  };
}
