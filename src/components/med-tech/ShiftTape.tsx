"use client";

import { Radio } from "lucide-react";

export interface TapeEvent {
  t: string;
  kind: "shift" | "pass" | "vitals" | "hold" | "page" | "prn" | "incident";
  text: string;
}

const tapeColor: Record<string, string> = {
  shift: "bg-slate-700 text-slate-200",
  pass: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
  vitals: "bg-sky-500/20 text-sky-200 ring-sky-500/40",
  hold: "bg-rose-500/20 text-rose-200 ring-rose-500/40",
  page: "bg-amber-500/20 text-amber-200 ring-amber-500/40",
  prn: "bg-violet-500/20 text-violet-200 ring-violet-500/40",
  incident: "bg-orange-500/20 text-orange-200 ring-orange-500/40",
};

export function ShiftTape({
  events,
  handoffTime,
}: {
  events: TapeEvent[];
  handoffTime?: string;
}) {
  return (
    <div className="h-28 border-t border-slate-800 bg-slate-950/60 backdrop-blur">
      <div className="px-6 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-violet-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Shift Tape
          </h3>
          <span className="text-[10px] text-slate-500">
            {events.length} events · live
          </span>
        </div>
        {handoffTime && (
          <div className="text-[10px] text-slate-500 font-mono">
            auto-handoff at {handoffTime}
          </div>
        )}
      </div>
      <div className="px-6 pb-3 flex gap-2 overflow-x-auto">
        {events.map((e, i) => (
          <div
            key={i}
            className={`shrink-0 rounded-lg px-3 py-2 text-[11px] ring-1 ${tapeColor[e.kind] ?? tapeColor.shift} min-w-[180px]`}
          >
            <div className="font-mono text-[10px] opacity-70 mb-0.5">
              {e.t}
            </div>
            <div className="leading-tight">{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
