import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { UUID_STRING_RE } from "@/lib/supabase/env";

export interface Facility {
  id: string;
  name: string;
}

interface FacilityState {
  selectedFacilityId: string | null;
  availableFacilities: Facility[];
  setSelectedFacility: (id: string | null) => void;
  setAvailableFacilities: (facilities: Facility[]) => void;
}

export const useFacilityStore = create<FacilityState>()(
  persist(
    (set) => ({
      selectedFacilityId: null,
      availableFacilities: [],
      setSelectedFacility: (id) => set({ selectedFacilityId: id }),
      setAvailableFacilities: (facilities) => set({ availableFacilities: facilities }),
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
