"use client";

import { CheckCircle2, ClipboardList, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  {
    title: "Safety & falls",
    items: ["Bed alarms tested on 114", "New orthostatic order on 212", "Wander door secured — east wing"],
  },
  {
    title: "Meds & treatments",
    items: ["PRN pain given 207 — reassess in 1 hr", "Antibiotic due change at midnight — pharmacy aware"],
  },
  {
    title: "Family / admin",
    items: ["Daughter called regarding room temp — maintenance ticket #4412"],
  },
] as const;

export default function CaregiverHandoffPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <MessageSquare className="h-5 w-5 text-teal-400" />
            Shift handoff
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Structured outgoing summary for oncoming nurse / lead (Phase 1 read-only scaffold).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline" className="border-teal-800/60 bg-teal-950/30 text-teal-200">
            Night → Day template
          </Badge>
        </CardContent>
      </Card>

      {sections.map((s) => (
        <Card key={s.title} className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-zinc-400" />
              {s.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {s.items.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-200"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500/80" aria-hidden />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
