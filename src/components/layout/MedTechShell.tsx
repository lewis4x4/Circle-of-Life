"use client";

import React, { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getAppRoleFromClaims, isAdminEligibleAppRole, isRecruiterRole, isMedTechRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { AccountNotLinkedNotice } from "@/components/auth/AccountNotLinkedNotice";
import { hasLinkedStaffRecord, loadAccountLinkContact, type AccountLinkContact } from "@/lib/auth/account-link";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { RoleAppFrame } from "@/design-system/components/RoleAppFrame";
import { useHavenAuth } from "@/contexts/haven-auth-context";

/**
 * MedTechShell — dedicated full-bleed shell for the Med-Tech Shift Cockpit.
 *
 * Navigation chrome uses the global `--chrome-*` tokens wherever this shell
 * adds fixed UI (e.g. loading); the cockpit UI itself remains full-bleed on
 * `bg-background` (dark-locked).
 *
 * It renders the shared RoleAppFrame (COL-714) with the Med-Tech tabs, and
 * handles:
 *  1. Dark theme enforcement
 *  2. Role guard (redirect non-med_tech users)
 *  3. The "not set up yet" state for a login with no staff record
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
    if (isMedTechRole(role) || (isAdminEligibleAppRole(role) && !isRecruiterRole(role))) {
      setIsMedTech(isMedTechRole(role));
      setAuthorized(true);
      setChecking(false);
      return;
    }

    // Other roles get redirected to their proper shell.
    if (role === "housekeeper" || isRecruiterRole(role)) {
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

  // A med-tech login with no staff record cannot have a shift, so the cockpit
  // would wait forever; show the shared "not set up yet" state (COL-661).
  // Admins visiting for oversight have no staff record by design and skip this.
  const pathname = usePathname();
  const { fullName } = useHavenAuth();
  const [facilityName, setFacilityName] = useState<string | null>(null);
  useEffect(() => {
    if (!authorized) return;
    let active = true;
    void loadCaregiverFacilityContext(createClient())
      .then((facility) => {
        if (active && facility.ok) setFacilityName(facility.ctx.facilityName ?? null);
      })
      .catch((error) => console.error("[MedTechShell] facility context failed", error));
    return () => {
      active = false;
    };
  }, [authorized]);
  const [staffLinked, setStaffLinked] = useState<boolean | null>(null);
  const [linkContact, setLinkContact] = useState<AccountLinkContact | null>(null);
  useEffect(() => {
    if (!isMedTech) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const linked = await hasLinkedStaffRecord(supabase, user.id);
      if (!active) return;
      setStaffLinked(linked);
      if (linked === false) {
        const facility = await loadCaregiverFacilityContext(supabase);
        const contact = await loadAccountLinkContact(supabase, facility.ok ? facility.ctx.facilityId : null);
        if (active) setLinkContact(contact);
      }
    })().catch((error) => console.error("[MedTechShell] staff link check failed", error));
    return () => {
      active = false;
    };
  }, [isMedTech]);
  const showNotLinked = staffLinked === false && !pathname?.startsWith("/med-tech/acknowledgments");

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
  // semantic tokens even if a future theme toggle momentarily flips the theme.
  //
  // One Med-Tech app (COL-714): the cockpit and the floor app share the same
  // frame and tabs, so a med-tech moves between them from the tab bar. Pages
  // scroll inside the frame; the full-bleed cockpit sizes itself to it (COL-639).
  return (
    <div className="dark">
      <RoleAppFrame
        app="med-tech"
        person={fullName}
        building={
          <h1 className="break-words text-lg font-semibold tracking-tight haven-chrome-fg md:text-xl">
            {facilityName ?? "Med-Tech"}
          </h1>
        }
        headerActions={<PilotFeedbackLauncher shellKind="med-tech" compact />}
      >
        {showNotLinked ? (
          <div className="p-4 md:p-8">
            <AccountNotLinkedNotice kind="staff" contact={linkContact} />
          </div>
        ) : (
          children
        )}
      </RoleAppFrame>
    </div>
  );
}
