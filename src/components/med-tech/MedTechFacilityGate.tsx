"use client";

import { useState, type ReactNode } from "react";

import { WorkingFacilitySelector } from "@/components/caregiver/WorkingFacilitySelector";
import { useHavenAuth } from "@/contexts/haven-auth-context";

/**
 * The med-tech shell is chromeless and never picks a facility, but the pages it
 * borrows from admin (Required reading) read the working facility from the
 * facility store. This resolves it the same way the caregiver and kitchen
 * headers do before rendering them.
 */
export function MedTechFacilityGate({ children }: { children: ReactNode }) {
  const { user } = useHavenAuth();
  const [workingId, setWorkingId] = useState("");

  return (
    <div className="space-y-4 px-4 pb-8 pt-4 md:px-6">
      {user?.id ? <WorkingFacilitySelector userId={user.id} onResolved={setWorkingId} /> : null}
      {workingId ? (
        <div key={workingId}>{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">Choose your working facility to see your required reading.</p>
      )}
    </div>
  );
}
