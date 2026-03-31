"use client";

import { Check, Clock3, Filter, Pill, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const medTabs = [
  { id: "due-now", label: "Due Now", count: 4 },
  { id: "next-hour", label: "Next Hour", count: 6 },
  { id: "held-refused", label: "Held/Refused", count: 2 },
  { id: "completed", label: "Completed", count: 11 },
] as const;

const medQueue = [
  {
    id: "m-001",
    resident: "Margaret Johnson",
    room: "114",
    medication: "Lisinopril 10mg",
    route: "Oral",
    schedule: "08:00 PM",
    status: "due-now",
    notes: "Check blood pressure before admin.",
  },
  {
    id: "m-002",
    resident: "Samuel Ortiz",
    room: "212",
    medication: "Metformin 500mg",
    route: "Oral",
    schedule: "08:15 PM",
    status: "due-soon",
    notes: "Give with snack.",
  },
  {
    id: "m-003",
    resident: "Elena Ramos",
    room: "207",
    medication: "Acetaminophen 325mg PRN",
    route: "Oral",
    schedule: "PRN eligible now",
    status: "due-soon",
    notes: "Pain score documented at 6/10.",
  },
] as const;

export default function CaregiverMedsPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">eMAR Queue</CardTitle>
          <CardDescription className="text-zinc-400">
            High-visibility medication workflow optimized for low-light shifts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Due Now" value="4" tone="danger" />
          <MetricPill label="Due < 60 min" value="6" tone="warning" />
          <MetricPill label="Held/Refused" value="2" tone="neutral" />
          <MetricPill label="Given" value="11" tone="success" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Medication Filters</CardTitle>
            <Button
              type="button"
              variant="outline"
              className="h-8 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Filters
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          {medTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg border px-3 py-2 text-left ${
                tab.id === "due-now"
                  ? "border-rose-700/70 bg-rose-900/20 text-rose-100"
                  : "border-zinc-800 bg-zinc-900/70 text-zinc-300"
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide">{tab.label}</p>
              <p className="mt-1 text-lg font-semibold">{tab.count}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {medQueue.map((item) => (
          <MedicationCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : tone === "success"
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function MedicationCard({
  item,
}: {
  item: {
    id: string;
    resident: string;
    room: string;
    medication: string;
    route: string;
    schedule: string;
    status: "due-now" | "due-soon";
    notes: string;
  };
}) {
  return (
    <Card
      className={`text-zinc-100 ${
        item.status === "due-now"
          ? "border-rose-800/70 bg-rose-950/20"
          : "border-zinc-800 bg-zinc-950/80"
      }`}
    >
      <CardContent className="p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{item.medication}</p>
            <p className="mt-1 text-xs text-zinc-300">
              {item.resident} - Room {item.room}
            </p>
          </div>
          <Badge
            className={
              item.status === "due-now"
                ? "border-rose-700 bg-rose-900/40 text-rose-200"
                : "border-amber-700 bg-amber-900/40 text-amber-200"
            }
          >
            {item.status === "due-now" ? "Due now" : "Due soon"}
          </Badge>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Pill className="h-3.5 w-3.5" />
            {item.route}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {item.schedule}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            {item.notes}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-10 bg-emerald-600 text-white hover:bg-emerald-500">
            <Check className="mr-1.5 h-4 w-4" />
            Given
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
          >
            <X className="mr-1.5 h-4 w-4" />
            Refused
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
