"use client";

import { CheckCircle2, Clock3, Filter, GripVertical, TriangleAlert, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const queueTabs = [
  { id: "all", label: "All", count: 14 },
  { id: "overdue", label: "Overdue", count: 3 },
  { id: "due-soon", label: "Due Soon", count: 5 },
  { id: "done", label: "Done", count: 6 },
] as const;

const taskQueue = [
  {
    id: "t-001",
    resident: "Margaret Johnson",
    room: "114",
    task: "Toileting assist + safety round",
    due: "Overdue by 12m",
    priority: "critical",
    category: "ADL",
  },
  {
    id: "t-002",
    resident: "Samuel Ortiz",
    room: "212",
    task: "Behavioral check-in and de-escalation note",
    due: "Due in 8m",
    priority: "high",
    category: "Observation",
  },
  {
    id: "t-003",
    resident: "Elena Ramos",
    room: "207",
    task: "Hydration round and intake log",
    due: "Due in 21m",
    priority: "normal",
    category: "ADL",
  },
  {
    id: "t-004",
    resident: "Dorothy Parker",
    room: "208",
    task: "Wound care follow-up photo upload",
    due: "Due in 45m",
    priority: "normal",
    category: "Clinical",
  },
] as const;

export default function CaregiverTasksPage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Task & ADL Queue</CardTitle>
          <CardDescription className="text-zinc-400">
            Prioritized work queue for this shift with swipe-ready completion cards.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Open Tasks" value="14" tone="neutral" />
          <MetricPill label="Overdue" value="3" tone="danger" />
          <MetricPill label="Due < 30 min" value="5" tone="warning" />
          <MetricPill label="Completed" value="6" tone="success" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Queue Filters</CardTitle>
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
          {queueTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg border px-3 py-2 text-left ${
                tab.id === "all"
                  ? "border-teal-700/70 bg-teal-900/20 text-teal-100"
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
        {taskQueue.map((task) => (
          <TaskCard key={task.id} task={task} />
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

function TaskCard({
  task,
}: {
  task: {
    id: string;
    resident: string;
    room: string;
    task: string;
    due: string;
    priority: "critical" | "high" | "normal";
    category: string;
  };
}) {
  const priorityClasses =
    task.priority === "critical"
      ? "border-rose-800/70 bg-rose-950/20"
      : task.priority === "high"
        ? "border-amber-800/70 bg-amber-950/20"
        : "border-zinc-800 bg-zinc-950/80";

  const priorityLabel =
    task.priority === "critical" ? "Critical" : task.priority === "high" ? "High" : "Normal";

  return (
    <Card className={`text-zinc-100 ${priorityClasses}`}>
      <CardContent className="p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="text-sm font-medium">{task.task}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-zinc-400">
                <UserRound className="h-3.5 w-3.5" />
                {task.resident} - Room {task.room}
              </p>
            </div>
          </div>
          <Badge
            className={
              task.priority === "critical"
                ? "border-rose-700 bg-rose-900/40 text-rose-200"
                : task.priority === "high"
                  ? "border-amber-700 bg-amber-900/40 text-amber-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-200"
            }
          >
            {priorityLabel}
          </Badge>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="border-zinc-700 text-zinc-300">
            {task.category}
          </Badge>
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Clock3 className="h-3.5 w-3.5" />
            {task.due}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
          >
            <TriangleAlert className="mr-1.5 h-4 w-4" />
            Escalate
          </Button>
          <Button
            type="button"
            className="h-9 bg-emerald-600 text-white hover:bg-emerald-500"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Complete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
