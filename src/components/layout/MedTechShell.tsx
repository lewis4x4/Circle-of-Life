"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isAdminEligibleAppRole, isMedTechRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";

/**
 * MedTechShell — dedicated full-bleed shell for the Med-Tech Shift Cockpit.
 *
 * Unlike CaregiverShell/AdminShell, this is a chromeless layout:
 * no sidebar, no top nav. The cockpit itself owns all chrome (ShiftBar,
 * ResidentRail, ShiftTape). This shell only handles:
 *  1. Dark theme enforcement
 *  2. Role guard (redirect non-med_tech users)
 *  3. Full-viewport container
 */
export function MedTechShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const router = useRouter();
  const themeSet = useRef(false);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  // Force dark theme
  useEffect(() => {
    if (!themeSet.current) {
      setTheme("dark");
      themeSet.current = true;
    }
  }, [setTheme]);

  // Role guard
  const checkAccess = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login?next=/med-tech");
      return;
    }

    const role = getAppRoleFromClaims(user);
    if (isMedTechRole(role)) {
      setAuthorized(true);
      setChecking(false);
      return;
    }

    // Redirect to appropriate shell
    if (role === "caregiver" || role === "housekeeper") {
      router.replace(getDashboardRouteForRole(role));
    } else if (role === "family") {
      router.replace("/family");
    } else if (isAdminEligibleAppRole(role)) {
      router.replace(getDashboardRouteForRole(role));
    } else {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkAccess();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [checkAccess]);

  if (checking || !authorized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Med-Tech cockpit...
        </div>
      </div>
    );
  }

  return (
    <div className="med-tech-shell min-h-screen bg-slate-950 text-white font-sans antialiased">
      <div className="fixed right-4 top-4 z-50">
        <PilotFeedbackLauncher shellKind="med-tech" compact />
      </div>
      {children}
    </div>
  );
}
