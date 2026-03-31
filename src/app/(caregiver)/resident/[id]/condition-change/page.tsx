"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function CaregiverResidentConditionChangePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";

  return (
    <div className="space-y-4">
      <Link
        href={`/caregiver/resident/${residentId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
      >
        <ArrowLeft className="h-4 w-4" />
        Resident
      </Link>

      <Card className="border-rose-900/50 bg-rose-950/20 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <Stethoscope className="h-5 w-5 text-rose-300" />
            Change of condition
          </CardTitle>
          <CardDescription className="text-rose-200/70">
            Report new or worsening symptoms for resident {residentId}. Phase 1 UI only — does not submit to the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-rose-900/40 bg-black/20 p-4 text-sm text-rose-100/90">
          Use the facility&apos;s nurse notification protocol for urgent changes. A structured reporting form will attach to
          incidents / clinical queues in a later phase.
        </CardContent>
      </Card>
    </div>
  );
}
