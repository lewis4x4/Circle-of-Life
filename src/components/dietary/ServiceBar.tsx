"use client";

import { useEffect, useState } from "react";
import {
  ChefHat, Utensils, Clock, AlertOctagon,
  Bluetooth, Wifi, Printer,
} from "lucide-react";
import type { ServiceBarData } from "./types";

export function ServiceBar({ data }: { data: ServiceBarData }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  const deltaItems = Object.entries(data.census_delta).filter(([, v]) => v !== 0);

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-stone-800 bg-stone-950/80 backdrop-blur">
      {/* Left: cook identity + meal context */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <ChefHat className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{data.cook_name}</div>
            <div className="text-xs text-stone-400">{data.facility_name}</div>
          </div>
        </div>

        <div className="h-9 w-px bg-stone-800" />

        <div className="flex items-center gap-2">
          <Utensils className="w-4 h-4 text-amber-400" />
          <span className="text-base font-semibold text-white">{data.meal_period}</span>
          <span className="text-xs text-stone-400">· bell at {data.scheduled_time}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 ring-1 ring-amber-500/40">
          <Clock className="w-3.5 h-3.5 text-amber-300" />
          <span className="text-sm font-mono font-semibold text-amber-200">
            {data.countdown_min > 0 ? `T−${data.countdown_min} min` : "Serving now"}
          </span>
        </div>
      </div>

      {/* Right: progress + census delta + clock + status */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-stone-500">Plated</div>
            <div className="text-lg font-mono font-semibold text-white">
              {data.plated}
              <span className="text-stone-500 text-sm">/{data.expected}</span>
            </div>
          </div>
          <div className="w-32 h-2 rounded-full bg-stone-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all"
              style={{ width: `${data.expected > 0 ? (data.plated / data.expected) * 100 : 0}%` }}
            />
          </div>
        </div>

        {deltaItems.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/40">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-300" />
            <span className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Census Δ</span>
            {deltaItems.map(([k, v]) => (
              <span key={k} className="text-xs font-mono text-rose-200 ml-1">
                {v > 0 ? "+" : ""}{v} {k}
              </span>
            ))}
          </div>
        )}

        <div className="text-2xl font-mono font-semibold tabular-nums text-white">{time}</div>

        <div className="flex items-center gap-2 text-stone-400">
          <Bluetooth className="w-4 h-4 text-sky-400" />
          <Wifi className="w-4 h-4 text-emerald-400" />
          <Printer className="w-4 h-4 text-emerald-400" />
        </div>
      </div>
    </div>
  );
}
