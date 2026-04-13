"use client";

import { ThermometerSun, Mic, CheckCircle2, AlertTriangle } from "lucide-react";
import type { HACCPEntry } from "./types";

export function HACCPStrip({
  entries,
  onVoice,
}: {
  entries: HACCPEntry[];
  onVoice: () => void;
}) {
  const allInRange = entries.every((e) => e.in_safe_range);

  return (
    <div className="h-32 border-t border-stone-800 bg-stone-950/70 backdrop-blur flex">
      {/* Left: HACCP header + voice button */}
      <div className="w-72 shrink-0 border-r border-stone-800 p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ThermometerSun className="w-4 h-4 text-orange-400" />
            <h3 className="text-xs font-semibold text-stone-300 uppercase tracking-wider">HACCP</h3>
          </div>
          {allInRange ? (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> All in range
            </span>
          ) : (
            <span className="text-[10px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Out of range
            </span>
          )}
        </div>
        <button
          onClick={onVoice}
          className="rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white py-3 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 transition"
        >
          <Mic className="w-4 h-4" /> Hold to Log Temp
        </button>
      </div>

      {/* Right: log strip */}
      <div className="flex-1 px-4 py-3 overflow-x-auto flex gap-2 items-start">
        {entries.length === 0 && (
          <div className="text-stone-600 text-xs self-center">No logs today — tap to add</div>
        )}
        {entries.map((h) => (
          <div
            key={h.id}
            className={`shrink-0 rounded-lg px-3 py-2 ring-1 min-w-[180px] ${
              h.in_safe_range
                ? "bg-emerald-500/10 ring-emerald-500/30"
                : "bg-rose-500/10 ring-rose-500/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-stone-400">{h.time}</span>
              {h.in_safe_range ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-3 h-3 text-rose-400" />
              )}
            </div>
            <div className="text-[11px] text-stone-200 truncate mt-0.5">{h.item}</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className={`text-lg font-mono font-semibold ${h.in_safe_range ? "text-white" : "text-rose-300"}`}>
                {h.temperature_f}°
              </span>
              <span className="text-[10px] text-stone-500">by {h.logged_by}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
