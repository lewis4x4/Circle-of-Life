"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

  const refresh = useCallback(async () => {
    const nextState = await requestRoundingSyncState();
    setState(nextState);
    return nextState;
  }, []);

  const flush = useCallback(async () => {
    const nextState = await flushQueuedRounds();
    setState(nextState);
    return nextState;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestRoundingSyncState().then((nextState) => {
      if (!cancelled) {
        setState(nextState);
      }
    });

    const unsubscribe = subscribeToRoundingSyncState((nextState) => setState(nextState));
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
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flush]);

  const queuedTaskIdSet = useMemo(() => new Set(state.queuedTaskIds), [state.queuedTaskIds]);

  return {
    ...state,
    queuedTaskIdSet,
    refresh,
    flush,
  };
}
