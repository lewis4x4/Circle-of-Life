import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { UUID_STRING_RE } from "@/lib/supabase/env";

export interface Facility {
  id: string;
  name: string;
}

/** In-memory only; not persisted — used to skip redundant fetches within SPA session */
export const FACILITY_LIST_TTL_MS = 5 * 60 * 1000;

interface FacilityState {
  selectedFacilityId: string | null;
  availableFacilities: Facility[];
  /** Epoch ms when `availableFacilities` was last set from network */
  facilitiesFetchedAt: number | null;
  setSelectedFacility: (id: string | null) => void;
  setAvailableFacilities: (facilities: Facility[]) => void;
}

export const useFacilityStore = create<FacilityState>()(
  persist(
    (set) => ({
      selectedFacilityId: null,
      availableFacilities: [],
      facilitiesFetchedAt: null,
      setSelectedFacility: (id) => set({ selectedFacilityId: id }),
      setAvailableFacilities: (facilities) =>
        set({ availableFacilities: facilities, facilitiesFetchedAt: Date.now() }),
    }),
    {
      name: "haven-facility-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedFacilityId: state.selectedFacilityId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<FacilityState, "selectedFacilityId">>;
        const id = p.selectedFacilityId;
        const selectedFacilityId = id != null && UUID_STRING_RE.test(id) ? id : null;
        return { ...current, ...p, selectedFacilityId };
      },
    },
  ),
);
