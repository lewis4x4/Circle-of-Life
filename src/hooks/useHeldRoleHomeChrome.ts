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

  const resolveSubtitle = useCallback(
    (trailingClause: string) =>
      resolveQuietRoleHomeSubtitle(authLoading, appRole, trailingClause, heldLeadRef.current),
    [authLoading, appRole],
  );

  const shellRoleLabel = resolveQuietRoleLabel(authLoading, appRole, heldRoleLabelRef.current);
  const brandAriaLabel = resolveHavenBrandAriaLabel(shellRoleLabel);
  const heldLead = heldLeadRef.current;

  return { resolveSubtitle, shellRoleLabel, brandAriaLabel, heldLead };
}
