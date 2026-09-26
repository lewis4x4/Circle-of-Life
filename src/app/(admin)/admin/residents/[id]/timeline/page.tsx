"use client";

import { useParams } from "next/navigation";

import { ResidentTimeline } from "@/components/care-events/timeline/ResidentTimeline";
import { RecordDetailSection } from "@/design-system/components/record-detail";

/**
 * Resident Timeline tab (spec 07A §6.3, §7 Tier 3): the digital Resident
 * Observation Log read from v_resident_timeline. Composed like the sibling
 * Vitals tab so the resident header and tab strip from the layout stay mounted.
 */
export default function ResidentTimelinePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";

  return (
    <div className="relative w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in duration-[var(--motion-duration)] ease-[var(--motion-ease)]">
        {/* COL-432: the resident <h1> comes from AdminResidentDetailShell; this
            tab adds context copy plus an <h2> section, not a second <h1>. */}
        <p className="text-sm text-muted-foreground">
          Care events, incidents, condition changes, behavior, shift notes, and safety checks in one place.
        </p>
        <RecordDetailSection title="Entries" description="Newest first, grouped by the facility's day.">
          <ResidentTimeline residentId={residentId} workspace="admin" />
        </RecordDetailSection>
      </div>
    </div>
  );
}
