"use client";

import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import type { FloorDevice } from "@/lib/floor/device-store";
import type { FloorUnlockProfile } from "@/lib/floor/unlock-profile";
import type { Database } from "@/types/database";

export type FloorSession = {
  supabase: SupabaseClient<Database>;
  device: FloorDevice;
  profile: FloorUnlockProfile;
  facility: CaregiverFacilityContext;
  timeZone: string;
  /** The tablet's own lock (Switch). */
  lock: () => void;
};

export const FloorSessionContext = createContext<FloorSession | null>(null);

/** The unlocked floor session; only screens inside `FloorShell` call it. */
export function useFloorSession(): FloorSession {
  const session = useContext(FloorSessionContext);
  if (!session) throw new Error("useFloorSession is used outside FloorShell");
  return session;
}
