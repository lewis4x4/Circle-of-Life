"use client";

import { useEffect, useState } from "react";

import { ResidentTimeline } from "@/components/care-events/timeline/ResidentTimeline";
import { checkCaregiverResidentScope, type CaregiverResidentScope } from "@/lib/caregiver/resident-scope";

import { useFloorSession } from "./FloorContext";
import { FloorScreenHeader } from "./FloorScreenHeader";
import { FloorStatePanel } from "./FloorStatePanel";

/**
 * Tier 3 on the tablet: the resident timeline the caregiver app shows (care
 * events, shift notes, observation exceptions), inside the floor shell so the
 * lock triggers keep running.
 */
export function FloorResidentRecord({ residentId }: { residentId: string }) {
  const { supabase } = useFloorSession();
  const [scope, setScope] = useState<CaregiverResidentScope | null>(null);

  useEffect(() => {
    let active = true;
    void checkCaregiverResidentScope(supabase, residentId).then((result) => {
      if (active) setScope(result);
    });
    return () => {
      active = false;
    };
  }, [supabase, residentId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FloorScreenHeader
        back={{ href: `/floor/residents/${residentId}`, label: "Back to the resident" }}
        title="Full record and history"
        subtitle="Care events, shift notes and check exceptions, newest first."
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {scope === null ? (
          <FloorStatePanel state="loading" title="Loading the record" />
        ) : scope.ok ? (
          <ResidentTimeline residentId={residentId} workspace="floor" />
        ) : (
          <FloorStatePanel state="empty" title={scope.error} />
        )}
      </div>
    </div>
  );
}
