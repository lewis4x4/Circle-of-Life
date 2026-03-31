import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        const selectedFacilityId = id != null && UUID_RE.test(id) ? id : null;
        return { ...current, ...p, selectedFacilityId };
      },
    },
  ),
);
