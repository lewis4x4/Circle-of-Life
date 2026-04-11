import { create } from "zustand";

import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";

const TTL_MS = 60_000;

function cacheKey(selectedFacilityId: string | null): string {
  return selectedFacilityId ?? "__all__";
}

type Entry = { data: AdminDashboardSnapshot; fetchedAt: number };

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
      entries: { ...s.entries, [cacheKey(fid)]: { data, fetchedAt: Date.now() } },
    })),
  invalidate: (fid) =>
    set((s) => {
      const next = { ...s.entries };
      delete next[cacheKey(fid)];
      return { entries: next };
    }),
}));
