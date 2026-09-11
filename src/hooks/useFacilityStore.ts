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
  /** The open Stand Up reporting Monday (YYYY-MM-DD) during which the facility was last chosen, or null when unknown. */
  selectedReportingPeriod: string | null;
  availableFacilities: Facility[];
  /** Epoch ms when `availableFacilities` was last set from network */
  facilitiesFetchedAt: number | null;
  /** Authenticated Supabase user id that owns the persisted facility-options cache. */
  facilitiesCacheUserId: string | null;
  setSelectedFacility: (id: string | null) => boolean;
  /** Records the reporting period a selection belongs to, so a new Monday does not inherit last week's ALF. */
  stampSelectionPeriod: (period: string) => void;
  /** Forms may veto user navigation while a save or unsaved draft is pending. */
  registerFacilityChangeGuard: (guard: (id: string | null) => boolean) => () => void;
  /** Security invalidation must clear context even when a form is dirty. */
  resetSelectedFacility: () => void;
  setAvailableFacilities: (facilities: Facility[], userId: string) => void;
  clearFacilityCache: () => void;
}

type PersistedFacilityState = Partial<
  Pick<
    FacilityState,
    "selectedFacilityId" | "selectedReportingPeriod" | "availableFacilities" | "facilitiesFetchedAt" | "facilitiesCacheUserId"
  >
>;

const REPORTING_PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizePeriod(value: unknown): string | null {
  return typeof value === "string" && REPORTING_PERIOD_RE.test(value) ? value : null;
}

/**
 * A persisted facility choice belongs to one reporting Monday. Accounts with more
 * than one grant must choose again once a new period opens; a choice made outside
 * Stand Up (period unknown) never carries into a new Monday.
 */
export function selectionBelongsToPeriod(selectedReportingPeriod: string | null, openPeriod: string): boolean {
  return selectedReportingPeriod !== null && selectedReportingPeriod === openPeriod;
}

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

// Navigation guards are transient and are never persisted with facility choices.
const facilityChangeGuards = new Set<(id: string | null) => boolean>();

export const useFacilityStore = create<FacilityState>()(
  persist(
    (set, get) => ({
      selectedFacilityId: null,
      selectedReportingPeriod: null,
      availableFacilities: [],
      facilitiesFetchedAt: null,
      facilitiesCacheUserId: null,
      setSelectedFacility: (id) => {
        if (id === get().selectedFacilityId) return true;
        try {
          for (const guard of facilityChangeGuards) {
            if (!guard(id)) return false;
          }
        } catch {
          return false;
        }
        // A new choice has no period until the Stand Up page stamps the open one.
        set({ selectedFacilityId: id, selectedReportingPeriod: null });
        return true;
      },
      stampSelectionPeriod: (period) => {
        if (get().selectedFacilityId === null || !REPORTING_PERIOD_RE.test(period)) return;
        set({ selectedReportingPeriod: period });
      },
      registerFacilityChangeGuard: (guard) => {
        facilityChangeGuards.add(guard);
        return () => { facilityChangeGuards.delete(guard); };
      },
      resetSelectedFacility: () => set({ selectedFacilityId: null, selectedReportingPeriod: null }),
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
        selectedReportingPeriod: state.selectedReportingPeriod,
        availableFacilities: state.availableFacilities,
        facilitiesFetchedAt: state.facilitiesFetchedAt,
        facilitiesCacheUserId: state.facilitiesCacheUserId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as PersistedFacilityState;
        const id = p.selectedFacilityId;
        const selectedFacilityId = id != null && UUID_STRING_RE.test(id) ? id : null;
        const selectedReportingPeriod = selectedFacilityId ? sanitizePeriod(p.selectedReportingPeriod) : null;
        const availableFacilities = sanitizeFacilityList(p.availableFacilities);
        const facilitiesFetchedAt = sanitizeFetchedAt(p.facilitiesFetchedAt);
        const facilitiesCacheUserId = sanitizeUserId(p.facilitiesCacheUserId);
        const hasValidFacilityCache =
          availableFacilities.length > 0 && facilitiesFetchedAt != null && facilitiesCacheUserId != null;

        return {
          ...current,
          selectedFacilityId,
          selectedReportingPeriod,
          availableFacilities: hasValidFacilityCache ? availableFacilities : [],
          facilitiesFetchedAt: hasValidFacilityCache ? facilitiesFetchedAt : null,
          facilitiesCacheUserId: hasValidFacilityCache ? facilitiesCacheUserId : null,
        };
      },
    },
  ),
);
