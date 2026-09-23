"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";

/**
 * Set the global facility scope exactly the way the header selector does:
 * the store (client pages), the cookie (server-rendered pages), then a
 * refresh so server components re-render for the new facility. Writing only
 * one of the two is the COL-406 drift — never do that from a page.
 */
export function useApplyFacilityScope(): {
  applyFacilityScope: (facilityId: string | null) => boolean;
  pending: boolean;
} {
  const router = useRouter();
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);
  const [pending, startTransition] = useTransition();

  const applyFacilityScope = useCallback(
    (facilityId: string | null) => {
      // A form's facility-change guard may veto the move (unsaved draft).
      if (setSelectedFacility(facilityId) === false) return false;
      syncSelectedFacilityCookie(facilityId);
      startTransition(() => router.refresh());
      return true;
    },
    [router, setSelectedFacility],
  );

  return { applyFacilityScope, pending };
}
