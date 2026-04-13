"use client";

import { Camera } from "lucide-react";

export interface ResidentItem {
  id: string;
  name: string;
  room: string;
  status: "stable" | "watch" | "alert" | "hold";
  note: string;
}

const statusDot: Record<string, string> = {
  stable: "bg-emerald-400",
  watch: "bg-amber-400",
  alert: "bg-rose-500",
  hold: "bg-rose-500 animate-pulse",
};

export function ResidentRail({ residents }: { residents: ResidentItem[] }) {
  return (
    <div className="w-[380px] shrink-0 border-l border-slate-800 bg-slate-950/40 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Residents</h2>
          <p className="text-xs text-slate-500">
            Tap for chart · long-press for incident
          </p>
        </div>
        <div className="flex gap-1.5">
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{" "}
            {residents.filter((r) => r.status === "stable").length}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{" "}
            {residents.filter((r) => r.status === "watch").length}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />{" "}
            {
              residents.filter(
                (r) => r.status === "alert" || r.status === "hold",
              ).length
            }
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 p-4 overflow-y-auto">
        {residents.map((r) => (
          <button
            key={r.id}
            className="group relative rounded-xl bg-slate-900 ring-1 ring-slate-800 hover:ring-slate-600 p-3 text-left transition"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-slate-500">{r.room}</span>
              <span
                className={`w-2 h-2 rounded-full ${statusDot[r.status] ?? statusDot.stable}`}
              />
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {r.name}
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {r.note}
            </div>
          </button>
        ))}
      </div>
      <div className="p-4 border-t border-slate-800 bg-slate-950/80">
        <button className="w-full rounded-xl bg-gradient-to-br from-orange-600 to-rose-600 hover:from-orange-500 hover:to-rose-500 text-white text-sm font-semibold py-3 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition">
          <Camera className="w-4 h-4" /> Capture Incident
        </button>
      </div>
    </div>
  );
}
