"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import { useApplyFacilityScope } from "@/hooks/useApplyFacilityScope";
import { useFacilityStore } from "@/hooks/useFacilityStore";

/**
 * COL-651: operations pages keep the facility in `?facility_id=` so links
 * (Home's task rows, paged history) open the right site. They used to carry
 * their own site dropdown that ignored the header. This binds the two: a
 * `facility_id` arriving in the URL becomes the header scope, and a header
 * change rewrites the URL through `onHeaderChange` (callers clear any state
 * that belonged to the previous facility). Returns the facility to render,
 * or "" when the page should show the facility gate.
 */
export function useHeaderBoundFacility(onHeaderChange: (facilityId: string | null) => void): string {
  const urlId = useSearchParams().get("facility_id") ?? "";
  const headerId = useFacilityStore((s) => s.selectedFacilityId) ?? "";
  const { applyFacilityScope } = useApplyFacilityScope();
  const seenUrl = useRef<string | null>(null);
  const seenHeader = useRef(headerId);

  useEffect(() => {
    if (seenUrl.current === urlId) return;
    seenUrl.current = urlId;
    if (urlId && urlId !== headerId) applyFacilityScope(urlId);
  }, [applyFacilityScope, headerId, urlId]);

  useEffect(() => {
    if (seenHeader.current === headerId) return;
    seenHeader.current = headerId;
    if (headerId !== urlId) onHeaderChange(headerId || null);
  }, [headerId, onHeaderChange, urlId]);

  return urlId || headerId;
}
