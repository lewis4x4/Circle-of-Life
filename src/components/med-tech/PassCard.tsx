"use client";

import {
  Pill,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";

export interface MedPassItem {
  id: string;
  resident: string;
  room: string;
  med: string;
  dose: string;
  time: string;
  status: "overdue" | "due" | "upcoming" | "hold" | "given";
  minutes: number;
  controlled: boolean;
  hold: string | null;
}

const statusRing: Record<string, string> = {
  overdue: "ring-rose-500/60 bg-rose-500/10",
  due: "ring-amber-400/60 bg-amber-400/10",
  upcoming: "ring-slate-600/40 bg-slate-800/40",
  hold: "ring-rose-500/80 bg-rose-500/15",
  given: "ring-emerald-500/50 bg-emerald-500/10",
};

function minutesLabel(m: number): string {
  if (m < 0) return `${Math.abs(m)} min overdue`;
  if (m === 0) return "due now";
  return `in ${m} min`;
}

export function PassCard({
  p,
  onOpen,
}: {
  p: MedPassItem;
  onOpen: (pass: MedPassItem) => void;
}) {
  const ring = statusRing[p.status] ?? statusRing.upcoming;
  const isOverdue = p.status === "overdue";
  const isHold = p.status === "hold";

  return (
    <button
      onClick={() => onOpen(p)}
      className={`w-full text-left rounded-2xl ring-1 ${ring} p-4 hover:ring-2 transition group backdrop-blur`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-slate-400">
              Room {p.room}
            </span>
            {p.controlled && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-[10px] font-semibold ring-1 ring-violet-500/40">
                <ShieldCheck className="w-3 h-3" /> C-II · WITNESS
              </span>
            )}
            {isOverdue && (
              <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                OVERDUE
              </span>
            )}
          </div>
          <div className="text-base font-semibold text-white">{p.resident}</div>
          <div className="text-sm text-slate-300 mt-0.5 flex items-center gap-1.5">
            <Pill className="w-3.5 h-3.5 text-slate-400" /> {p.med} ·{" "}
            <span className="text-slate-400">{p.dose}</span>
          </div>
          {isHold && p.hold && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/40 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-200 leading-snug">
                <span className="font-semibold">HOLD · </span>
                {p.hold}
              </div>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-mono font-semibold tabular-nums text-white">
            {p.time}
          </div>
          <div
            className={`text-xs mt-0.5 ${isOverdue ? "text-rose-400 font-semibold" : "text-slate-400"}`}
          >
            {minutesLabel(p.minutes)}
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-white transition mt-2 ml-auto" />
        </div>
      </div>
    </button>
  );
}
