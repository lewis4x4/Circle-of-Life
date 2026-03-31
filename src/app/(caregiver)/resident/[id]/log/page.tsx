"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function CaregiverResidentLogPage() {
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
            <FileText className="h-5 w-5 text-teal-400" />
            Shift log
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Narrative entries for this resident (ID {residentId}). Phase 1 scaffold — bind to clinical documentation tables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-300">
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-zinc-400">
            No entries for the current shift yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
