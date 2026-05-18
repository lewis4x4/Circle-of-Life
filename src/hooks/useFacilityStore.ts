import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

import { UUID_STRING_RE } from "@/lib/supabase/env";

export interface Facility {
  id: string;
  name: string;
}

/** Used to skip redundant facility-option fetches within a short authenticated session window. */
export const FACILITY_LIST_TTL_MS = 5 * 60 * 1000;

interface FacilityState {
  selectedFacilityId: string | null;
  availableFacilities: Facility[];
  /** Epoch ms when `availableFacilities` was last set from network */
  facilitiesFetchedAt: number | null;
  /** Authenticated Supabase user id that owns the persisted facility-options cache. */
  facilitiesCacheUserId: string | null;
  setSelectedFacility: (id: string | null) => void;
  setAvailableFacilities: (facilities: Facility[], userId: string) => void;
  clearFacilityCache: () => void;
}

type PersistedFacilityState = Partial<
  Pick<
    FacilityState,
    "selectedFacilityId" | "availableFacilities" | "facilitiesFetchedAt" | "facilitiesCacheUserId"
  >
>;

function isFacility(value: unknown): value is Facility {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const maybeFacility = value as Partial<Facility>;
  return (
    typeof maybeFacility.id === "string" &&
    UUID_STRING_RE.test(maybeFacility.id) &&
    typeof maybeFacility.name === "string" &&
    maybeFacility.name.trim().length > 0
  );
}

function sanitizeFacilityList(value: unknown): Facility[] {
  return Array.isArray(value) ? value.filter(isFacility) : [];
}

function sanitizeFetchedAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sanitizeUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

const noopServerStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useFacilityStore = create<FacilityState>()(
  persist(
    (set) => ({
      selectedFacilityId: null,
      availableFacilities: [],
      facilitiesFetchedAt: null,
      facilitiesCacheUserId: null,
      setSelectedFacility: (id) => set({ selectedFacilityId: id }),
      setAvailableFacilities: (facilities, userId) =>
        set({
          availableFacilities: facilities,
          facilitiesFetchedAt: Date.now(),
          facilitiesCacheUserId: userId,
        }),
      clearFacilityCache: () =>
        set({
          availableFacilities: [],
          facilitiesFetchedAt: null,
          facilitiesCacheUserId: null,
        }),
    }),
    {
      name: "haven-facility-storage",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : noopServerStorage)),
      partialize: (state) => ({
        selectedFacilityId: state.selectedFacilityId,
        availableFacilities: state.availableFacilities,
        facilitiesFetchedAt: state.facilitiesFetchedAt,
        facilitiesCacheUserId: state.facilitiesCacheUserId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as PersistedFacilityState;
        const id = p.selectedFacilityId;
        const selectedFacilityId = id != null && UUID_STRING_RE.test(id) ? id : null;
        const availableFacilities = sanitizeFacilityList(p.availableFacilities);
        const facilitiesFetchedAt = sanitizeFetchedAt(p.facilitiesFetchedAt);
        const facilitiesCacheUserId = sanitizeUserId(p.facilitiesCacheUserId);
        const hasValidFacilityCache =
          availableFacilities.length > 0 && facilitiesFetchedAt != null && facilitiesCacheUserId != null;

        return {
          ...current,
          selectedFacilityId,
          availableFacilities: hasValidFacilityCache ? availableFacilities : [],
          facilitiesFetchedAt: hasValidFacilityCache ? facilitiesFetchedAt : null,
          facilitiesCacheUserId: hasValidFacilityCache ? facilitiesCacheUserId : null,
        };
      },
    },
  ),
);
