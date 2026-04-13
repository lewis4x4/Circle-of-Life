"use client";

import { PassCard, type MedPassItem } from "./PassCard";

export interface NowLaneProps {
  passes: MedPassItem[];
  onOpen: (pass: MedPassItem) => void;
}

export function NowLane({ passes, onOpen }: NowLaneProps) {
  const overdue = passes.filter(
    (p) => p.status === "overdue" || p.status === "hold",
  );
  const dueNow = passes.filter((p) => p.status === "due");
  const upcoming = passes.filter((p) => p.status === "upcoming");

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4 p-6 overflow-y-auto">
      {/* Needs Attention */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-rose-300 uppercase tracking-wider">
              Needs Attention
            </h2>
            <span className="text-xs text-slate-500">{overdue.length}</span>
          </div>
        </div>
        <div className="space-y-2.5">
          {overdue.map((p) => (
            <PassCard key={p.id} p={p} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {/* Due Now */}
      <div>
        <div className="flex items-center justify-between mb-3 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">
              Due Now
            </h2>
            <span className="text-xs text-slate-500">{dueNow.length}</span>
          </div>
        </div>
        <div className="space-y-2.5">
          {dueNow.map((p) => (
            <PassCard key={p.id} p={p} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {/* Upcoming */}
      <div>
        <div className="flex items-center justify-between mb-3 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-slate-500" />
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Upcoming · 30 min
            </h2>
            <span className="text-xs text-slate-500">{upcoming.length}</span>
          </div>
        </div>
        <div className="space-y-2.5">
          {upcoming.map((p) => (
            <PassCard key={p.id} p={p} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}
