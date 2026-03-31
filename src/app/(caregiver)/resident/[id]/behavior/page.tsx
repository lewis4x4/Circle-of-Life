"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function CaregiverResidentBehaviorPage() {
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

      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <Brain className="h-5 w-5 text-violet-400" />
            Behavior support
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Triggers, interventions, and escalation paths for resident {residentId}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge className="border-amber-800/60 bg-amber-950/40 text-amber-100">Sundowning risk</Badge>
            <Badge variant="outline" className="border-zinc-600 text-zinc-300">
              Preferred: music + redirection
            </Badge>
          </div>
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-zinc-400">
            No new behavioral events logged this shift (scaffold).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
