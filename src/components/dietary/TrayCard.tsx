"use client";

import { ShieldAlert, Sparkles } from "lucide-react";
import type { TrayTicket } from "./types";

export const DIET_COLOR: Record<string, string> = {
  Regular:           "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  "NCS · 60g":       "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  NCS:               "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  Renal:             "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  "Mech Soft":       "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  "Mech Soft · NCS": "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  Puree:             "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  Vegetarian:        "bg-lime-500/15 text-lime-300 ring-lime-500/40",
  Vegan:             "bg-lime-500/15 text-lime-300 ring-lime-500/40",
  "Low Sodium":      "bg-sky-500/15 text-sky-300 ring-sky-500/40",
};

export const STATUS_BG: Record<string, string> = {
  queued:   "bg-stone-800/60 ring-stone-700",
  prepping: "bg-amber-500/10 ring-amber-500/40",
  plating:  "bg-orange-500/10 ring-orange-500/40",
  plated:   "bg-sky-500/10 ring-sky-500/40",
  passed:   "bg-emerald-500/10 ring-emerald-500/40",
  delivered:"bg-emerald-500/10 ring-emerald-500/40",
  refused:  "bg-rose-500/10 ring-rose-500/40",
  npo:      "bg-rose-500/10 ring-rose-500/40",
  hospital: "bg-rose-500/10 ring-rose-500/40",
};

export function TrayCard({
  ticket,
  onOpen,
}: {
  ticket: TrayTicket;
  onOpen: (t: TrayTicket) => void;
}) {
  const statusClass = STATUS_BG[ticket.status] ?? STATUS_BG.queued;
  const dietClass = DIET_COLOR[ticket.diet_label] ?? "bg-stone-700/60 text-stone-300 ring-stone-600";

  return (
    <button
      onClick={() => onOpen(ticket)}
      className={`w-full text-left rounded-xl ring-1 ${statusClass} p-3 hover:ring-2 transition group`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-mono text-stone-400">{ticket.room}</span>
            {ticket.fortify && <Sparkles className="w-3 h-3 text-amber-400" />}
          </div>
          <div className="text-sm font-semibold text-white truncate">{ticket.resident_name}</div>
        </div>
        <span className="px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-200 text-[10px] font-bold ring-1 ring-violet-500/40 font-mono shrink-0">
          L{ticket.iddsi_level}
        </span>
      </div>

      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${dietClass}`}>
        {ticket.diet_label}
      </div>

      {ticket.allergens.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {ticket.allergens.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-300 text-[10px] font-semibold ring-1 ring-rose-500/40"
            >
              <ShieldAlert className="w-2.5 h-2.5" /> {a}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-stone-700/50 text-[11px] text-stone-400 leading-snug line-clamp-2">
        {ticket.menu_items.join(" · ")}
      </div>

      {(ticket.diet_type === "ncs" || ticket.diet_type === "renal") && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-stone-400">
          {ticket.diet_type === "ncs" && ticket.carb_count_g != null && (
            <span className="font-mono">{ticket.carb_count_g}g C</span>
          )}
          {ticket.diet_type === "renal" && ticket.sodium_mg != null && (
            <span className="font-mono">{ticket.sodium_mg}mg Na</span>
          )}
        </div>
      )}
    </button>
  );
}
