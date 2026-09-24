"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkingFacilitySelector } from "@/components/caregiver/WorkingFacilitySelector";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isDietaryRole, isAdminEligibleAppRole, isRecruiterRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { RoleAppFrame } from "@/design-system/components/RoleAppFrame";
import { useHavenAuth } from "@/contexts/haven-auth-context";

/**
 * DietaryShell — dedicated full-bleed shell for the Dietary Command Deck.
 *
 * Renders the shared RoleAppFrame (COL-714) with the Cook tabs. This shell handles:
 *  1. Dark theme enforcement
 *  2. Role guard (cook, dietary, dietary_aide, and admin-eligible roles allowed)
 *  3. Full-viewport container
 */
export function DietaryShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { fullName } = useHavenAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);



  const checkAccess = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login?next=/dietary");
      return;
    }

    setUserId(user.id);
    const role = getAppRoleFromClaims(user);

    // Dietary staff and any admin-eligible role can access
    if (isDietaryRole(role) || (isAdminEligibleAppRole(role) && !isRecruiterRole(role))) {
      setAuthorized(true);
      setChecking(false);
      return;
    }

    // Redirect non-dietary roles to their shells
    if (role === "housekeeper" || isRecruiterRole(role)) {
      router.replace(getDashboardRouteForRole(role));
    } else if (role === "family") {
      router.replace("/family");
    } else {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    queueMicrotask(() => {
      void checkAccess();
    });
  }, [checkAccess]);

  if (checking || !authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading kitchen cockpit…
        </div>
      </div>
    );
  }

  // Kitchen cockpit is dark-only by design (line-cook station glare). The
  // shared RoleAppFrame gives the Cook app the same header and tabs as every
  // other staff app (COL-714): Kitchen, Reading and Me (My employee file).
  return (
    <div className="dark">
      <RoleAppFrame
        app="cook"
        person={fullName}
        building={userId ? <WorkingFacilitySelector userId={userId} onResolved={setWorkingId} /> : null}
      >
        {workingId ? <div key={workingId}>{children}</div> : <p className="p-4">Choose your working facility to open kitchen service.</p>}
      </RoleAppFrame>
    </div>
  );
}
