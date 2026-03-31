"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bath } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const adlRows = [
  { label: "Mobility", status: "Partial assist — walker" },
  { label: "Toileting", status: "Scheduled Q2H" },
  { label: "Feeding", status: "Independent" },
];

export default function CaregiverResidentAdlPage() {
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
            <Bath className="h-5 w-5 text-sky-400" />
            ADL snapshot
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Activities of daily living cues for resident {residentId} (demo copy — replace with care plan / ADL assessments).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {adlRows.map((r) => (
            <div key={r.label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
              <p className="font-medium text-zinc-100">{r.label}</p>
              <p className="text-xs text-zinc-400">{r.status}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
