"use client";

import Link from "next/link";
import { BellRing, ChevronRight, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const rows = [
  {
    id: "fu-1",
    residentId: "demo-res-1",
    title: "Orthostatic BP recheck",
    due: "Due in 45 min",
    room: "114",
    name: "Margaret Johnson",
    priority: "high" as const,
  },
  {
    id: "fu-2",
    residentId: "demo-res-2",
    title: "Skin check (heels)",
    due: "Due end of shift",
    room: "212",
    name: "Samuel Ortiz",
    priority: "medium" as const,
  },
  {
    id: "fu-3",
    residentId: "demo-res-3",
    title: "Family callback — diet change",
    due: "Overdue 20 min",
    room: "207",
    name: "Elena Ramos",
    priority: "high" as const,
  },
];

export default function CaregiverFollowupsPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <BellRing className="h-5 w-5 text-teal-400" />
            Follow-ups
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Tasks and callbacks carried across shifts (Phase 1 scaffold — wire to tasks / clinical data later).
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id} className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <Badge
                    className={
                      r.priority === "high"
                        ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }
                  >
                    {r.priority === "high" ? "Priority" : "Routine"}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400">
                  {r.name} · Room {r.room}
                </p>
                <p className="flex items-center gap-1 text-xs text-amber-200/90">
                  <Clock3 className="h-3.5 w-3.5" />
                  {r.due}
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
