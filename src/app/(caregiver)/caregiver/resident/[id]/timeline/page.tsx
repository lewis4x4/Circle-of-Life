"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, History, Loader2 } from "lucide-react";

import { ResidentTimeline } from "@/components/care-events/timeline/ResidentTimeline";
import { buttonVariants } from "@/components/ui/button";
import { checkCaregiverResidentScope, type CaregiverResidentScope } from "@/lib/caregiver/resident-scope";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Caregiver resident Timeline (spec 07A §6.3 "Resident profile (admin and
 * caregiver): new Timeline tab"). Lives inside the dark-locked caregiver
 * shell; semantic tokens only and 44 px targets.
 */
export default function CaregiverResidentTimelinePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);
  const [scope, setScope] = useState<CaregiverResidentScope | null>(null);

  // The timeline reads through RLS, so a resident in another building rendered
  // as an empty timeline with no explanation (COL-661 A5).
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
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="flex flex-col gap-4">
        <Link
          prefetch={false}
          href={`/caregiver/resident/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 w-fit gap-2")}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to resident
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full border border-border bg-card">
            <History className="size-5 text-foreground" aria-hidden />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Timeline</h2>
            <p className="text-sm text-muted-foreground">
              Care events, safety checks, shift notes, and visits for this resident, newest first.
            </p>
          </div>
        </div>
      </div>

      {scope === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading timeline" />
        </div>
      ) : scope.ok ? (
        <ResidentTimeline residentId={residentId} workspace="caregiver" />
      ) : (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {scope.error}
        </p>
      )}
    </div>
  );
}
