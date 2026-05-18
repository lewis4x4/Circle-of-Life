"use client";

import { useState, useCallback } from "react";

export interface FacilityAuditHookRow {
  id: string;
  facility_id?: string;
  timestamp: string;
  user: string | null;
  changed_by_display: string;
  table_name: string;
  record_id: string;
  field_name: string | null;
  action: string;
  old_value: unknown;
  new_value: unknown;
  old_value_text: string | null;
  new_value_text: string | null;
  summary: string;
  ip_address?: unknown;
  user_agent?: string | null;
}

interface AuditLogResponse {
  data: FacilityAuditHookRow[];
  pagination: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    has_next: boolean;
  };
}

export interface AuditLogFilters {
  fieldName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  table_name_in?: string[];
  action_in?: string[];
  user_ids?: string[];
  search?: string;
}

interface UseFacilityAuditLogReturn {
  entries: FacilityAuditHookRow[];
  isLoading: boolean;
  error: string | null;
  total: number;
  page: number;
  hasNext: boolean;
  refetch: (filters: AuditLogFilters) => Promise<void>;
}

function buildQuery(filters: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams({
    page: String(filters.page ?? 1),
    per_page: String(filters.pageSize ?? 50),
  });
  if (filters.fieldName) params.set("field_name", filters.fieldName);
  if (filters.startDate) params.set("from", filters.startDate);
  if (filters.endDate) params.set("to", filters.endDate);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  const tables = filters.table_name_in;
  if (tables && tables.length > 0) params.set("table_name_in", tables.join(","));
  const actions = filters.action_in;
  if (actions && actions.length > 0) params.set("action_in", actions.join(","));
  const actors = filters.user_ids;
  if (actors && actors.length > 0) params.set("user_ids", actors.join(","));
  return params;
}

export function useFacilityAuditLog(facilityId: string): UseFacilityAuditLogReturn {
  const [entries, setEntries] = useState<FacilityAuditHookRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);

  const refetch = useCallback(
    async (filters: AuditLogFilters) => {
      setIsLoading(true);
      setError(null);
      const newPage = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 50;
      setPage(newPage);

      try {
        const params = buildQuery({ ...filters, page: newPage, pageSize });
        const res = await fetch(`/api/admin/facilities/${facilityId}/audit-log?${params}`);
        if (!res.ok) {
          throw new Error("Failed to fetch audit log");
        }
        const json = (await res.json()) as AuditLogResponse;
        const rows = json.data ?? [];
        setEntries(
          rows.map((entry) => {
            const row = entry as FacilityAuditHookRow & { changed_at?: string; changed_by?: string | null };
            const ts = row.changed_at ?? row.timestamp;
            return {
              ...row,
              timestamp: ts,
              user: row.changed_by ?? null,
            };
          }),
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
