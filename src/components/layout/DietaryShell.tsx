"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkingFacilitySelector } from "@/components/caregiver/WorkingFacilitySelector";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isDietaryRole, isAdminEligibleAppRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/**
 * DietaryShell — dedicated full-bleed shell for the Dietary Command Deck.
 *
 * No top/side nav here; any future fixed chrome in this shell should use
 * `--chrome-*` tokens for parity with other operator surfaces.
 *
 * Chromeless layout: no sidebar, no top nav. The cockpit owns all chrome.
 * This shell handles:
 *  1. Dark theme enforcement
 *  2. Role guard (dietary, dietary_aide, and admin-eligible roles allowed)
 *  3. Full-viewport container
 */
export function DietaryShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState("");
  const [exitError, setExitError] = useState<string | null>(null);
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading kitchen cockpit…
        </div>
      </div>
    );
  }

  // Kitchen cockpit is dark-only by design (line-cook station glare).
  // Token names below resolve correctly in light + dark; the `setTheme("dark")`
  // above forces dark unconditionally so the surrounding chrome reads the
  // dark variant of every token regardless of system preference.
  return (
    <div className="dark min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="flex items-center justify-between gap-4 border-b border-border p-3">
        {userId && <WorkingFacilitySelector userId={userId} onResolved={setWorkingId} />}
        <Link href="/dietary/acknowledgments" className="underline">Required reading</Link>
        <button type="button" onClick={() => { void createClient().auth.signOut({ scope: "local" }).then(({ error }) => { if (error) setExitError(error.message); else router.replace("/login"); }); }}>Sign out</button>
        {exitError && <p role="alert">{exitError}</p>}
      </header>
      {workingId ? <div key={workingId}>{children}</div> : <p className="p-4">Choose your working facility to open kitchen service.</p>}
    </div>
  );
}
