"use client";

import { useState, useEffect } from "react";
import {
  Users,
  Clock,
  Bluetooth,
  Wifi,
  Battery,
  Zap,
} from "lucide-react";

export interface ShiftBarProps {
  techName: string;
  techInitials: string;
  shiftLabel: string;
  unitLabel: string;
  assignedCount: number;
  elapsedLabel: string;
}

export function ShiftBar({
  techName,
  techInitials,
  shiftLabel,
  unitLabel,
  assignedCount,
  elapsedLabel,
}: ShiftBarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white font-semibold">
            {techInitials}
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{techName}</div>
            <div className="text-xs text-slate-400">
              {shiftLabel} · {unitLabel}
            </div>
          </div>
        </div>
        <div className="h-8 w-px bg-slate-800" />
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {assignedCount} residents
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> {elapsedLabel} elapsed
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-2xl font-mono font-semibold tabular-nums text-white tracking-tight">
          {time}
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Bluetooth className="w-4 h-4 text-sky-400" />
          <Wifi className="w-4 h-4 text-emerald-400" />
          <Battery className="w-4 h-4 text-emerald-400" />
        </div>
        <button className="group relative px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-lg shadow-rose-500/30 transition">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4" /> Hold for SOS
          </span>
        </button>
      </div>
    </div>
  );
}
