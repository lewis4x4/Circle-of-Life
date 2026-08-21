/* eslint-disable react-hooks/refs -- hold-last role-home chrome across auth hydration without a loading flash */
import { useCallback, useRef } from "react";

import {
  getRoleHomeLead,
  getResolvedRoleLabel,
  isRoleHomeLabelReady,
  resolveHavenBrandAriaLabel,
  resolveQuietRoleHomeSubtitle,
  resolveQuietRoleLabel,
} from "@/lib/auth/dashboard-routing";

/**
 * Holds the last resolved role-home chrome across auth hydration so flagship
 * surfaces never flash "Loading role home" on first paint.
 */
export function useHeldRoleHomeChrome(authLoading: boolean, appRole: string) {
  const heldLeadRef = useRef<string | null>(null);
  const heldRoleLabelRef = useRef<string | null>(null);

  if (isRoleHomeLabelReady(authLoading, appRole)) {
    heldLeadRef.current = getRoleHomeLead(false, appRole);
    heldRoleLabelRef.current = getResolvedRoleLabel(false, appRole);
  }

  const heldLead = heldLeadRef.current;
  const heldRoleLabel = heldRoleLabelRef.current;

  const resolveSubtitle = useCallback(
    (trailingClause: string) =>
      resolveQuietRoleHomeSubtitle(authLoading, appRole, trailingClause, heldLead),
    [authLoading, appRole, heldLead],
  );

  const shellRoleLabel = resolveQuietRoleLabel(authLoading, appRole, heldRoleLabel);
  const brandAriaLabel = resolveHavenBrandAriaLabel(shellRoleLabel);

  return { resolveSubtitle, shellRoleLabel, brandAriaLabel, heldLead };
}
