"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";

import { ResidentTimeline } from "@/components/care-events/timeline/ResidentTimeline";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Caregiver resident Timeline (spec 07A §6.3 "Resident profile (admin and
 * caregiver): new Timeline tab"). Lives inside the dark-locked caregiver
 * shell; semantic tokens only and 44 px targets.
 */
export default function CaregiverResidentTimelinePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";

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
              Care events, shift notes, and observation exceptions for this resident, newest first.
            </p>
          </div>
        </div>
      </div>

      <ResidentTimeline residentId={residentId} workspace="caregiver" />
    </div>
  );
}
