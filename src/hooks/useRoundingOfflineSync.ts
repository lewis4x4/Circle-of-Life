"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  flushQueuedRounds,
  requestRoundingSyncState,
  subscribeToRoundingSyncState,
  supportsRoundingOfflineSync,
  type RoundingSyncState,
} from "@/lib/pwa/rounding-sync";

function initialState(): RoundingSyncState {
  return {
    pendingCount: 0,
    queuedTaskIds: [],
    isSyncing: false,
    lastSyncedAt: null,
    lastError: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    supported: supportsRoundingOfflineSync(),
  };
}

export function useRoundingOfflineSync() {
  const [state, setState] = useState<RoundingSyncState>(initialState);
  const generation = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!mounted.current) return initialState();
    const current = ++generation.current;
    const nextState = await requestRoundingSyncState();
    if (current === generation.current && mounted.current) setState(nextState);
    return nextState;
  }, []);

  const flush = useCallback(async () => {
    if (!mounted.current) return null;
    const current = ++generation.current;
    setState((state) => ({ ...state, isSyncing: true }));
    try {
      const nextState = await flushQueuedRounds();
      if (current === generation.current && mounted.current) setState(nextState);
      return nextState;
    } catch (error) {
      if (current === generation.current && mounted.current) setState((state) => ({ ...state, isSyncing: false, lastError: error instanceof Error ? error.message : "Outbox could not sync. Your observations remain saved on this device." }));
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = subscribeToRoundingSyncState(() => { void refresh(); });
    let authRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      generation.current += 1;
      setState(initialState());
      if (authRefreshTimer) clearTimeout(authRefreshTimer);
      // Read scoped queue state after the auth callback releases its session lock.
      if (session?.user) authRefreshTimer = setTimeout(() => { void refresh(); }, 0);
    });
    const handleOnline = () => {
      setState((current) => ({ ...current, online: true }));
      void flush();
    };
    const handleOffline = () => {
      setState((current) => ({ ...current, online: false }));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted.current = false;
      generation.current += 1;
      if (authRefreshTimer) clearTimeout(authRefreshTimer);
      subscription.unsubscribe();
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flush, refresh]);

  const queuedTaskIdSet = useMemo(() => new Set(state.queuedTaskIds), [state.queuedTaskIds]);

  return {
    ...state,
    queuedTaskIdSet,
    refresh,
    flush,
  };
}
