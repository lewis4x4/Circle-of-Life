"use client";

import Link from "next/link";
import { Activity, ChevronRight, Pill } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const prnRows = [
  {
    id: "prn-1",
    residentId: "demo-res-1",
    name: "Margaret Johnson",
    room: "114",
    med: "Hydrocodone 5mg",
    given: "10:15 PM",
    reassess: "11:15 PM",
    status: "due" as const,
  },
  {
    id: "prn-2",
    residentId: "demo-res-2",
    name: "Samuel Ortiz",
    room: "212",
    med: "Lorazepam 0.5mg",
    given: "9:40 PM",
    reassess: "10:40 PM",
    status: "overdue" as const,
  },
];

export default function CaregiverPrnFollowupPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <Pill className="h-5 w-5 text-violet-400" />
            PRN follow-up
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Reassessment windows after PRN administration (Phase 1 scaffold — connect to eMAR events).
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-2">
        {prnRows.map((r) => (
          <Card key={r.id} className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.med}</span>
                  <Badge
                    className={
                      r.status === "overdue"
                        ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
                        : "border-amber-800/60 bg-amber-950/40 text-amber-200"
                    }
                  >
                    {r.status === "overdue" ? "Overdue reassess" : "Reassess soon"}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400">
                  {r.name} · Room {r.room}
                </p>
                <p className="flex items-center gap-1 text-xs text-zinc-300">
                  <Activity className="h-3.5 w-3.5 text-zinc-500" />
                  Given {r.given} · Target {r.reassess}
                </p>
              </div>
              <Link
                href={`/caregiver/resident/${r.residentId}`}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0 text-zinc-400 hover:text-white")}
                aria-label={`Open ${r.name}`}
              >
                <ChevronRight className="h-5 w-5" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
