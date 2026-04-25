"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DashboardPreferences = {
  dashboardId: string;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  savedViews: Array<{
    id: string;
    name: string;
    filters?: Record<string, unknown>;
    createdAt?: string;
  }>;
  exists: boolean;
  updatedAt?: string;
};

const EMPTY: DashboardPreferences = {
  dashboardId: "",
  columnOrder: [],
  columnVisibility: {},
  savedViews: [],
  exists: false,
};

export type UseDashboardPreferencesOptions = {
  endpoint?: string;
  debounceMs?: number;
  fetchImpl?: typeof fetch;
};

export type UseDashboardPreferencesResult = {
  preferences: DashboardPreferences;
  loading: boolean;
  error: string | null;
  saving: boolean;
  setColumnOrder: (next: string[]) => void;
  setColumnVisibility: (next: Record<string, boolean>) => void;
  resetToDefaults: () => void;
  flush: () => Promise<void>;
};

export function useDashboardPreferences(
  dashboardId: string,
  options: UseDashboardPreferencesOptions = {},
): UseDashboardPreferencesResult {
  const endpoint = options.endpoint ?? "/api/v2/preferences";
  const debounceMs = options.debounceMs ?? 500;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const [preferences, setPreferences] = useState<DashboardPreferences>({
    ...EMPTY,
    dashboardId,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<DashboardPreferences>(preferences);
  latestRef.current = preferences;

  const persist = useCallback(
    async (next: DashboardPreferences): Promise<void> => {
      setSaving(true);
      try {
        const response = await doFetch(endpoint, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dashboardId: next.dashboardId,
            columnOrder: next.columnOrder,
            columnVisibility: next.columnVisibility,
            savedViews: next.savedViews,
          }),
        });
        if (!response.ok) {
          throw new Error(`Save preferences failed (${response.status})`);
        }
        const json = (await response.json()) as DashboardPreferences;
        setPreferences({ ...json, dashboardId: next.dashboardId });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [doFetch, endpoint],
  );

  const schedulePersist = useCallback(
    (next: DashboardPreferences): void => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        void persist(next);
      }, debounceMs);
    },
    [debounceMs, persist],
  );

  const flush = useCallback(async (): Promise<void> => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    await persist(latestRef.current);
  }, [persist]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void doFetch(`${endpoint}?dashboardId=${encodeURIComponent(dashboardId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Load preferences failed (${response.status})`);
        }
        return (await response.json()) as DashboardPreferences;
      })
      .then((data) => {
        if (cancelled) return;
        setPreferences({ ...data, dashboardId });
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId, doFetch, endpoint]);

  // Persist any pending change before unmount.
  useEffect(() => {
    return () => {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        void persist(latestRef.current);
      }
    };
  }, [persist]);

  const setColumnOrder = useCallback(
    (next: string[]) => {
      setPreferences((prev) => {
        const updated = { ...prev, columnOrder: next };
        schedulePersist(updated);
        return updated;
      });
    },
    [schedulePersist],
  );

  const setColumnVisibility = useCallback(
    (next: Record<string, boolean>) => {
      setPreferences((prev) => {
        const updated = { ...prev, columnVisibility: next };
        schedulePersist(updated);
        return updated;
      });
    },
    [schedulePersist],
  );

  const resetToDefaults = useCallback(() => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        columnOrder: [],
        columnVisibility: {},
      };
      schedulePersist(updated);
      return updated;
    });
  }, [schedulePersist]);

  return {
    preferences,
    loading,
    error,
    saving,
    setColumnOrder,
    setColumnVisibility,
    resetToDefaults,
    flush,
  };
}
