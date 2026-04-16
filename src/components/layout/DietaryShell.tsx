"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isDietaryRole, isAdminEligibleAppRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/**
 * DietaryShell — dedicated full-bleed shell for the Dietary Command Deck.
 *
 * Chromeless layout: no sidebar, no top nav. The cockpit owns all chrome.
 * This shell handles:
 *  1. Dark theme enforcement
 *  2. Role guard (dietary, dietary_aide, and admin-eligible roles allowed)
 *  3. Full-viewport container
 */
export function DietaryShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const router = useRouter();
  const themeSet = useRef(false);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("dark");
      themeSet.current = true;
    }
  }, [setTheme]);

  const checkAccess = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login?next=/dietary");
      return;
    }

    const role = getAppRoleFromClaims(user);

    // Dietary staff and any admin-eligible role can access
    if (isDietaryRole(role) || isAdminEligibleAppRole(role)) {
      setAuthorized(true);
      setChecking(false);
      return;
    }

    // Redirect non-dietary roles to their shells
    if (role === "med_tech") {
      router.replace("/med-tech");
    } else if (role === "caregiver" || role === "housekeeper") {
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
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading kitchen cockpit...
        </div>
      </div>
    );
  }

  return (
    <div className="dietary-shell min-h-screen bg-stone-950 text-white font-sans antialiased">
      {children}
    </div>
  );
}
