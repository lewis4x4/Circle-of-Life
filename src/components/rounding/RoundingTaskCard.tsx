"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, UserRound } from "lucide-react";

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
        card: "bg-rose-950/40 border-rose-500/30 shadow-[inset_0_0_20px_rgba(225,29,72,0.1)]",
        badge: "border-rose-700/50 bg-rose-500/20 text-rose-300",
        icon: <AlertTriangle aria-hidden className="h-4 w-4 text-rose-400" />,
      };
    case "overdue":
    case "escalated":
      return {
        card: "bg-amber-950/40 border-amber-500/30",
        badge: "border-amber-700/50 bg-amber-500/20 text-amber-300",
        icon: <Clock3 aria-hidden className="h-4 w-4 text-amber-400" />,
      };
    case "completed_on_time":
    case "completed_late":
      return {
        card: "bg-emerald-950/20 border-emerald-900/30 opacity-70",
        badge: "border-emerald-800/50 bg-emerald-900/40 text-emerald-300",
        icon: <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-400" />,
      };
    default:
      return {
        card: "bg-white/[0.03] border-white/5 shadow-sm",
        badge: "border-white/10 bg-white/5 text-zinc-300",
        icon: <UserRound aria-hidden className="h-4 w-4 text-zinc-400" />,
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
    <Link href={href} className="block group tap-responsive">
      <div className={`rounded-[1.5rem] p-5 border backdrop-blur-xl transition-all duration-300 group-hover:brightness-110 ${tone.card}`}>
        <div className="flex flex-col gap-4">
          
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-black/40 border border-white/5 flex items-center justify-center shrink-0 shadow-inner">
                 {tone.icon}
              </div>
              <div className="flex flex-col">
                <h3 className="text-lg font-display text-white tracking-wide">{task.residentName}</h3>
                <p className="text-xs text-zinc-400/80 font-medium tracking-wide">
                  {task.roomLabel ? `${task.roomLabel} · ` : ""}
                  {task.assignedStaffName ? `Assigned to ${task.assignedStaffName}` : "Open assignment"}
                </p>
              </div>
            </div>
            
            <div className={`px-2.5 py-1 rounded border text-[10px] uppercase font-bold tracking-widest leading-none flex items-center shrink-0 ${tone.badge}`}>
               {formatStatus(task.derivedStatus)}
            </div>
          </div>

          <div className="flex items-center justify-between pl-[3.25rem] border-t border-white/5 pt-3">
             <div className="flex flex-col">
                <span className="text-sm font-semibold text-zinc-200">{formatDueLabel(task.dueAt)}</span>
                {task.note && <span className="text-xs text-zinc-500 mt-0.5">{task.note}</span>}
             </div>
             
             <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors shrink-0">
               <ArrowRight className="h-4 w-4 text-zinc-300" />
             </div>
          </div>

        </div>
      </div>
    </Link>
  );
}
