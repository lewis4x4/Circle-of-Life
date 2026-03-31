import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface Facility {
  id: string
  name: string
  // Additional facility branding/context fields can be expanded later
}

interface FacilityState {
  selectedFacilityId: string | null
  availableFacilities: Facility[]
  setSelectedFacility: (id: string | null) => void
  setAvailableFacilities: (facilities: Facility[]) => void
}

export const useFacilityStore = create<FacilityState>()(
  persist(
    (set) => ({
      selectedFacilityId: null, // null represents "All Facilities" for Org Admins/Owners
      availableFacilities: [
        // Mocked initial data to prove UI functionality
        { id: "fac_123", name: "Oakridge ALF" },
        { id: "fac_456", name: "Pine Valley Estates" }
      ],
      setSelectedFacility: (id) => set({ selectedFacilityId: id }),
      setAvailableFacilities: (facilities) => set({ availableFacilities: facilities }),
    }),
    {
      name: 'haven-facility-storage', // Persist selected facility across sessions/reloads
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedFacilityId: state.selectedFacilityId }), // Only persist the selected ID to avoid stale config data
    }
  )
)
