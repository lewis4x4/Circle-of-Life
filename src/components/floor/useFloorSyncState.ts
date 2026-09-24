"use client";

import { useCallback, useEffect, useState } from "react";

import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { requestCareEventQueueState, subscribeCareEventQueue } from "@/lib/offline/care-event-queue";

import { useOnline } from "./useOnline";

export type FloorSyncState = { kind: "synced" } | { kind: "waiting"; count: number } | { kind: "offline"; count: number };

/**
 * "Synced", "2 waiting" or "Offline" for the top bar: both offline queues,
 * this person's items. `refresh` asks both queues again (after a replay pass).
 */
export function useFloorSyncState(userId: string | null): { sync: FloorSyncState; refresh: () => void } {
  const online = useOnline();
  const rounding = useRoundingOfflineSync();
  const [careEventsPending, setCareEventsPending] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    requestCareEventQueueState(userId)
      .then((state) => {
        if (active) setCareEventsPending(state.pendingCount);
      })
      .catch(() => undefined);
    const unsubscribe = subscribeCareEventQueue(
      (state) => {
        if (active) setCareEventsPending(state.pendingCount);
      },
      { ownerUserId: userId },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  const refreshRounding = rounding.refresh;
  const refresh = useCallback(() => {
    void refreshRounding();
    if (!userId) return;
    requestCareEventQueueState(userId)
      .then((state) => setCareEventsPending(state.pendingCount))
      .catch(() => undefined);
  }, [refreshRounding, userId]);

  const count = rounding.pendingCount + careEventsPending;
  const sync: FloorSyncState = !online ? { kind: "offline", count } : count > 0 ? { kind: "waiting", count } : { kind: "synced" };
  return { sync, refresh };
}

export function syncStateLabel(state: FloorSyncState): string {
  if (state.kind === "offline") return state.count > 0 ? `Offline, ${state.count} waiting` : "Offline";
  if (state.kind === "waiting") return `${state.count} waiting`;
  return "Synced";
}
