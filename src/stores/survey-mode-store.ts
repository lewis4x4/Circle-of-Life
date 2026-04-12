/**
 * Survey Mode Store — Zustand store for survey visit mode
 */

import { create } from "zustand";

export interface SurveySession {
  facilityId: string;
  facilityName: string;
  surveyorName?: string;
  surveyorAgency?: string;
  activatedAt: string;
}

interface SurveyModeState {
  activeSession: SurveySession | null;
  activateSurveyMode: (session: SurveySession) => void;
  deactivateSurveyMode: () => void;
}

export const useSurveyModeStore = create<SurveyModeState>((set) => ({
  activeSession: null,
  activateSurveyMode: (session) => set({ activeSession: session }),
  deactivateSurveyMode: () => set({ activeSession: null }),
}));

/** Helper to check if survey mode is currently active */
export function isSurveyModeActive(): boolean {
  return useSurveyModeStore.getState().activeSession !== null;
}
