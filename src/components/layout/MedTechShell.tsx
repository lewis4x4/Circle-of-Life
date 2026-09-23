"use client";

import Link from "next/link";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isAdminEligibleAppRole, isMarketingRole, isMedTechRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";

/**
 * MedTechShell — dedicated full-bleed shell for the Med-Tech Shift Cockpit.
 *
 * Navigation chrome uses the global `--chrome-*` tokens wherever this shell
 * adds fixed UI (e.g. loading); the cockpit UI itself remains full-bleed on
 * `bg-background` (dark-locked).
 *
 * Unlike CaregiverShell/AdminShell, this is a chromeless layout:
 * no sidebar, no top nav. The cockpit itself owns all chrome (ShiftBar,
 * ResidentRail, ShiftTape). This shell only handles:
 *  1. Dark theme enforcement
 *  2. Role guard (redirect non-med_tech users)
 *  3. Full-viewport container
 */
export function MedTechShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isMedTech, setIsMedTech] = useState(false);

  // Force dark theme


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
    // Med-tech staff use this surface day-to-day. Admins/owners also need
    // visibility here for support and oversight, so they're allowed through
    // rather than bounced back to their own dashboard.
    if (isMedTechRole(role) || (isAdminEligibleAppRole(role) && !isMarketingRole(role))) {
      setIsMedTech(isMedTechRole(role));
      setAuthorized(true);
      setChecking(false);
      return;
    }

    // Other roles get redirected to their proper shell.
    if (role === "housekeeper" || isMarketingRole(role)) {
      router.replace(getDashboardRouteForRole(role));
    } else if (role === "family") {
      router.replace("/family");
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
      // `dark` class on the outer wrapper forces the dark-variant tokens
      // regardless of next-themes state (see comment on the main wrapper
      // below for the full rationale).
      <div className="dark">
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading Med-Tech cockpit…
          </div>
        </div>
      </div>
    );
  }

  // Med-Tech cockpit is dark-only by design: med pass at 05:00 over a
  // line-cook-style station, full-screen on a tablet — a light flash is
  // both glare-painful and clinically risky (misreads of low-contrast PRN
  // text). The `dark` class on the outer wrapper enforces dark-variant
  // semantic tokens even if a future theme toggle or `useTheme` race
  // momentarily flips the theme state. `setTheme("dark")` above remains
  // for cross-component side effects (e.g., portals rendering outside
  // this wrapper) but it is no longer the only guardrail.
  return (
    // The links sit in a header row in normal flow, not a fixed overlay: fixed,
    // they covered the title of every page under them on a phone (COL-639).
    // `main` owns the remaining height so the full-bleed cockpit still fits.
    <div className="dark">
      <div className="flex h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <header className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-b border-border px-4 py-2 md:px-6">
          {/* Med-techs also use the caregiver floor app (owner ruling 2026-09-22). */}
          {isMedTech ? (
            <Link href="/caregiver" className="text-sm underline">Floor app</Link>
          ) : null}
          <Link href="/employee-file" className="text-sm underline">My employee file</Link>
          <Link href="/med-tech/acknowledgments" className="rounded border border-border bg-background px-3 py-2 text-sm">Required reading</Link>
          <PilotFeedbackLauncher shellKind="med-tech" compact />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
