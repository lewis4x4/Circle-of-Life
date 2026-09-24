"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readFloorCache, writeFloorCache } from "@/lib/floor/memory-cache";

export type FloorQueryState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: T; refreshing: boolean };

/**
 * One read behind a floor screen, kept in the floor's memory cache for
 * `maxAgeMs` so switching tabs does not refetch everything. The cache is
 * emptied on lock, so nothing outlives the person who read it. A null key
 * waits (idle).
 */
export function useFloorQuery<T>(key: string | null, loader: () => Promise<T>, maxAgeMs = 30_000) {
  const [state, setState] = useState<FloorQueryState<T>>(() => {
    if (!key) return { status: "idle" };
    const cached = readFloorCache<T>(key, maxAgeMs);
    return cached !== null ? { status: "success", data: cached, refreshing: false } : { status: "loading" };
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const generation = useRef(0);

  const run = useCallback(
    async (force: boolean) => {
      if (!key) {
        setState({ status: "idle" });
        return;
      }
      const current = ++generation.current;
      const cached = force ? null : readFloorCache<T>(key, maxAgeMs);
      if (cached !== null) {
        setState({ status: "success", data: cached, refreshing: false });
        return;
      }
      setState((previous) => (previous.status === "success" ? { ...previous, refreshing: true } : { status: "loading" }));
      try {
        const data = await loaderRef.current();
        if (current !== generation.current) return;
        writeFloorCache(key, data);
        setState({ status: "success", data, refreshing: false });
      } catch (error) {
        if (current !== generation.current) return;
        console.error("[floor] read failed", key, error);
        setState((previous) => (previous.status === "success" ? { ...previous, refreshing: false } : { status: "error" }));
      }
    },
    [key, maxAgeMs],
  );

  useEffect(() => {
    void run(false);
    return () => {
      generation.current += 1;
    };
  }, [run]);

  const reload = useCallback(() => void run(true), [run]);
  return { state, reload };
}
