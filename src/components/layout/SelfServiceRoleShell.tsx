"use client";

import { AppShell } from "@/components/layout/AppShell";
import { CaregiverShell } from "@/components/layout/CaregiverShell";
import { DietaryShell } from "@/components/layout/DietaryShell";
import { MedTechShell } from "@/components/layout/MedTechShell";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getAppRoleFromClaims, isDietaryRole, isMedTechRole } from "@/lib/auth/app-role";

export type SelfServiceShellKind = "med-tech" | "kitchen" | "floor" | "admin";

/** Which role shell a self-service page (e.g. My employee file) mounts for the signed-in role. */
export function selfServiceShellFor(role: string): SelfServiceShellKind {
  if (isMedTechRole(role)) return "med-tech";
  if (isDietaryRole(role)) return "kitchen";
  if (role === "housekeeper") return "floor";
  return "admin";
}

/**
 * Self-service pages that every staff role links to (COL-654: /employee-file rendered
 * outside every shell, a dead end on a phone). Mounts the same shell the role's own
 * home uses, so the header, nav and way back are the ones that person already knows.
 */
export function SelfServiceRoleShell({ children }: { children: React.ReactNode }) {
  const { appRole, loading, user } = useHavenAuth();
  const role = getAppRoleFromClaims(user) || appRole;

  if (loading && !role) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }

  switch (selfServiceShellFor(role)) {
    case "med-tech":
      return <MedTechShell>{children}</MedTechShell>;
    case "kitchen":
      return <DietaryShell>{children}</DietaryShell>;
    case "floor":
      return (
        <div className="dark">
          <CaregiverShell>{children}</CaregiverShell>
        </div>
      );
    default:
      return <AppShell>{children}</AppShell>;
  }
}
