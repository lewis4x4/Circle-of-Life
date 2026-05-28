import { create } from "zustand";

import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";

const TTL_MS = 60_000;
// Each snapshot is a heavy object (22 query results). Cap so a user who
// scopes through many facilities over a long session doesn't accumulate
// stale snapshots indefinitely.
const MAX_ENTRIES = 8;

function cacheKey(selectedFacilityId: string | null): string {
  return selectedFacilityId ?? "__all__";
}

type Entry = { data: AdminDashboardSnapshot; fetchedAt: number };

function pruneToCap(entries: Record<string, Entry>): Record<string, Entry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  // Drop the oldest entries by fetchedAt until we're at the cap.
  const sortedByAge = keys
    .map((k) => [k, entries[k]] as const)
    .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const toDrop = sortedByAge.slice(0, keys.length - MAX_ENTRIES);
  const next = { ...entries };
  for (const [k] of toDrop) delete next[k];
  return next;
}

export const useDashboardSnapshotCache = create<{
  entries: Record<string, Entry>;
  getFresh: (selectedFacilityId: string | null) => AdminDashboardSnapshot | null;
  setEntry: (selectedFacilityId: string | null, data: AdminDashboardSnapshot) => void;
  invalidate: (selectedFacilityId: string | null) => void;
}>((set, get) => ({
  entries: {},
  getFresh: (fid) => {
    const k = cacheKey(fid);
    const e = get().entries[k];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > TTL_MS) return null;
    return e.data;
  },
  setEntry: (fid, data) =>
    set((s) => ({
      entries: pruneToCap({ ...s.entries, [cacheKey(fid)]: { data, fetchedAt: Date.now() } }),
    })),
  invalidate: (fid) =>
    set((s) => {
      const next = { ...s.entries };
      delete next[cacheKey(fid)];
      return { entries: next };
    }),
}));
