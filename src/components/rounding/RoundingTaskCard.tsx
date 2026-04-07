"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TaskStatus =
  | "upcoming"
  | "due_soon"
  | "due_now"
  | "overdue"
  | "critically_overdue"
  | "missed"
  | "completed_on_time"
  | "completed_late"
  | "excused"
  | "reassigned"
  | "escalated";

export type RoundingTaskCardData = {
  id: string;
  residentId: string;
  residentName: string;
  roomLabel?: string | null;
  assignedStaffName?: string | null;
  dueAt: string;
  derivedStatus: TaskStatus;
  note?: string | null;
};

function statusTone(status: TaskStatus) {
  switch (status) {
    case "critically_overdue":
    case "missed":
      return {
        card: "border-rose-800/70 bg-rose-950/30",
        badge: "border-rose-700 bg-rose-900/40 text-rose-200",
        icon: <AlertTriangle aria-hidden className="h-4 w-4 text-rose-300" />,
      };
    case "overdue":
    case "escalated":
      return {
        card: "border-amber-800/70 bg-amber-950/25",
        badge: "border-amber-700 bg-amber-900/40 text-amber-200",
        icon: <Clock3 aria-hidden className="h-4 w-4 text-amber-300" />,
      };
    case "completed_on_time":
    case "completed_late":
      return {
        card: "border-emerald-800/70 bg-emerald-950/20",
        badge: "border-emerald-700 bg-emerald-900/40 text-emerald-200",
        icon: <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-300" />,
      };
    default:
      return {
        card: "border-zinc-800 bg-zinc-950/80",
        badge: "border-zinc-700 bg-zinc-900/50 text-zinc-200",
        icon: <UserRound aria-hidden className="h-4 w-4 text-zinc-300" />,
      };
  }
}

function formatStatus(status: TaskStatus) {
  return status.replaceAll("_", " ");
}

function formatDueLabel(value: string) {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return "Due time unknown";
  const deltaMs = dueAt.getTime() - Date.now();
  const minutes = Math.round(Math.abs(deltaMs) / (60 * 1000));
  if (deltaMs >= 0) {
    if (minutes < 1) return "Due now";
    return `Due in ${minutes}m`;
  }
  if (minutes < 1) return "Just overdue";
  return `${minutes}m overdue`;
}

export function RoundingTaskCard({
  task,
  href,
}: {
  task: RoundingTaskCardData;
  href: string;
}) {
  const tone = statusTone(task.derivedStatus);

  return (
    <Link href={href} className="block">
      <Card className={`transition-colors hover:bg-zinc-900/90 ${tone.card}`}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {tone.icon}
              <div>
                <CardTitle className="text-base text-zinc-100">{task.residentName}</CardTitle>
                <CardDescription className="text-zinc-400">
                  {task.roomLabel ? `${task.roomLabel} · ` : ""}
                  {task.assignedStaffName ? `Assigned to ${task.assignedStaffName}` : "Open assignment"}
                </CardDescription>
              </div>
            </div>
            <Badge className={tone.badge}>{formatStatus(task.derivedStatus)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-100">{formatDueLabel(task.dueAt)}</p>
            {task.note ? <p className="text-xs text-zinc-400">{task.note}</p> : null}
          </div>
          <div className="inline-flex items-center gap-1 text-xs font-medium text-zinc-300">
            Open
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
