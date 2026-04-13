"use client";

import { useState } from "react";
import { Radio, X } from "lucide-react";

export interface TapeEvent {
  t: string;
  kind: "shift" | "pass" | "vitals" | "hold" | "page" | "prn" | "incident";
  text: string;
}

const tapeColor: Record<string, string> = {
  shift:    "bg-slate-700 text-slate-200 ring-slate-600",
  pass:     "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
  vitals:   "bg-sky-500/20 text-sky-200 ring-sky-500/40",
  hold:     "bg-rose-500/20 text-rose-200 ring-rose-500/40",
  page:     "bg-amber-500/20 text-amber-200 ring-amber-500/40",
  prn:      "bg-violet-500/20 text-violet-200 ring-violet-500/40",
  incident: "bg-orange-500/20 text-orange-200 ring-orange-500/40",
};

const kindLabel: Record<string, string> = {
  shift:    "Shift",
  pass:     "Med Pass",
  vitals:   "Vitals",
  hold:     "Hold",
  page:     "Page",
  prn:      "PRN",
  incident: "Incident",
};

export function ShiftTape({
  events,
  handoffTime,
}: {
  events: TapeEvent[];
  handoffTime?: string;
}) {
  const [expanded, setExpanded] = useState<TapeEvent | null>(null);

  return (
    <>
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
          {events.length === 0 && (
            <div className="text-[11px] text-slate-600 self-center">No events yet</div>
          )}
          {events.map((e, i) => (
            <button
              key={i}
              onClick={() => setExpanded(e)}
              className={`shrink-0 rounded-lg px-3 py-2 text-[11px] ring-1 ${tapeColor[e.kind] ?? tapeColor.shift} min-w-[180px] text-left hover:ring-2 active:scale-95 transition`}
            >
              <div className="font-mono text-[10px] opacity-70 mb-0.5">{e.t}</div>
              <div className="leading-tight">{e.text}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Event detail popover */}
      {expanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(null)}
          />
          <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 w-80 rounded-2xl bg-slate-900 ring-1 ring-slate-700 shadow-2xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ${tapeColor[expanded.kind] ?? tapeColor.shift}`}>
                  {kindLabel[expanded.kind] ?? expanded.kind}
                </span>
                <span className="text-xs font-mono text-slate-400">{expanded.t}</span>
              </div>
              <button
                onClick={() => setExpanded(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-white leading-relaxed">{expanded.text}</p>
          </div>
        </>
      )}
    </>
  );
}
