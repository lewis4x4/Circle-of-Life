"use client";

import { useEffect, useState } from "react";

import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { requestCareEventQueueState, subscribeCareEventQueue } from "@/lib/offline/care-event-queue";

import { useOnline } from "./useOnline";

export type FloorSyncState = { kind: "synced" } | { kind: "waiting"; count: number } | { kind: "offline"; count: number };

/** "Synced", "2 waiting" or "Offline" for the top bar: both offline queues, this person's items. */
export function useFloorSyncState(userId: string | null): FloorSyncState {
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

  const count = rounding.pendingCount + careEventsPending;
  if (!online) return { kind: "offline", count };
  return count > 0 ? { kind: "waiting", count } : { kind: "synced" };
}

export function syncStateLabel(state: FloorSyncState): string {
  if (state.kind === "offline") return state.count > 0 ? `Offline, ${state.count} waiting` : "Offline";
  if (state.kind === "waiting") return `${state.count} waiting`;
  return "Synced";
}
