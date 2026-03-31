"use client";

import { Camera, ChevronRight, Clock3, FileText, ShieldAlert, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const steps = [
  { id: 1, title: "What happened", status: "active" },
  { id: 2, title: "Who was involved", status: "pending" },
  { id: 3, title: "When and where", status: "pending" },
  { id: 4, title: "Immediate actions", status: "pending" },
  { id: 5, title: "Photo evidence", status: "pending" },
  { id: 6, title: "Review and submit", status: "pending" },
] as const;

const categoryOptions = [
  "Fall with injury",
  "Fall without injury",
  "Behavioral event",
  "Medication variance",
  "Elopement risk",
  "Environmental hazard",
];

export default function CaregiverIncidentDraftPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Incident Reporter</CardTitle>
          <CardDescription className="text-zinc-400">
            Guided draft flow for fast, complete, and auditable incident submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                step.status === "active"
                  ? "border-amber-700/70 bg-amber-900/20"
                  : "border-zinc-800 bg-zinc-900/70"
              }`}
            >
              <p className="text-sm font-medium text-zinc-100">
                {step.id}. {step.title}
              </p>
              <Badge
                className={
                  step.status === "active"
                    ? "border-amber-700 bg-amber-900/40 text-amber-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300"
                }
              >
                {step.status === "active" ? "In progress" : "Queued"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Step 1: What happened?</CardTitle>
          <CardDescription className="text-zinc-400">
            Start with incident type and short factual summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {categoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                className={`rounded-lg border px-3 py-2 text-left text-xs ${
                  category === "Fall with injury"
                    ? "border-rose-700/70 bg-rose-900/20 text-rose-100"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-300"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <Input
            value="Resident found on floor near bedside table, alert and responsive."
            readOnly
            className="border-zinc-800 bg-zinc-900 text-zinc-100"
          />

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-zinc-300">
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <Clock3 className="h-3.5 w-3.5" />
                Occurred at
              </span>
              <p className="mt-1 font-medium text-zinc-100">8:42 PM</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-zinc-300">
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <UserRound className="h-3.5 w-3.5" />
                Resident
              </span>
              <p className="mt-1 font-medium text-zinc-100">Margaret Johnson (114)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evidence & Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
            <p className="inline-flex items-center gap-1 text-sm font-medium">
              <Camera className="h-4 w-4 text-zinc-400" />
              Photo attachment queue
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Add room/environment photos and injury reference images before final submit.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
            <p className="inline-flex items-center gap-1 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-zinc-400" />
              Severity and reportability
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Draft flow flags AHCA/insurance triggers after step completion.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
        >
          <FileText className="mr-1.5 h-4 w-4" />
          Save Draft
        </Button>
        <Button type="button" className="h-11 bg-amber-600 text-white hover:bg-amber-500">
          Next Step
          <ChevronRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
