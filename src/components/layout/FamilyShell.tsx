"use client";

import React, { useEffect, useState } from "react";

import { AccountNotLinkedNotice } from "@/components/auth/AccountNotLinkedNotice";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { RoleAppFrame } from "@/design-system/components/RoleAppFrame";
import { hasLinkedResident } from "@/lib/auth/account-link";
import { loadFamilyBuildingName } from "@/lib/family/family-building";
import { createClient } from "@/lib/supabase/client";

/** The person's name from their account, never their email (COL-659). */
function personNameFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const name = metadata?.full_name ?? metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * FamilyShell — the family portal on the shared RoleAppFrame (COL-714): the same
 * header as every staff app (the loved one's building, the person, Sign out) and
 * the family tabs, which are the FAMILY_SECTIONS list the in-page pills also use.
 */
export function FamilyShell({ children }: { children: React.ReactNode }) {
  const [personName, setPersonName] = useState<string | null>(null);
  const [buildingName, setBuildingName] = useState<string | null>(null);
  // null until checked (or when the check failed): pages render as before.
  const [residentLinked, setResidentLinked] = useState<boolean | null>(null);

  // Family portal is light-locked at the route group layout
  // (`src/app/(family)/layout.tsx` wraps in `<div className="light">`). We
  // intentionally do NOT call `setTheme("light")` here — that would clobber
  // the user's admin theme choice when navigating between the two shells.

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!cancelled) setPersonName(personNameFromMetadata(user?.user_metadata));
        // A family login with no linked resident saw a blank welcome, "$0.00 ·
        // In good standing" on billing and live tabs; show one state instead (COL-661).
        if (user?.id) {
          const linked = await hasLinkedResident(supabase, user.id);
          if (!cancelled) setResidentLinked(linked);
          if (linked) {
            const name = await loadFamilyBuildingName(supabase, user.id);
            if (!cancelled) setBuildingName(name);
          }
        }
      } catch {
        if (!cancelled) setPersonName(null);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setPersonName(personNameFromMetadata(session?.user?.user_metadata));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="family-shell">
      <RoleAppFrame
        app="family"
        person={personName}
        hideNav={residentLinked === false}
        building={
          <p className="break-words text-lg font-semibold tracking-tight haven-chrome-fg md:text-xl">
            {buildingName ?? "Family Portal"}
          </p>
        }
        headerActions={<PilotFeedbackLauncher shellKind="family" compact />}
      >
        {residentLinked === false ? (
          <div className="px-4 pb-8 pt-8 md:px-6">
            <AccountNotLinkedNotice kind="family" contact={null} />
          </div>
        ) : (
          children
        )}
      </RoleAppFrame>
    </div>
  );
}
