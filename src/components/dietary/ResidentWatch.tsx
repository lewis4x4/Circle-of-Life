"use client";

import { Sparkles, X, Bell, Droplet, TrendingDown, Truck, FileText } from "lucide-react";
import type { FortificationRec, NPOResident, RefusalEntry } from "./types";

export function ResidentWatch({
  fortification,
  npo,
  refusals,
  onFortifyApply,
}: {
  fortification: FortificationRec[];
  npo: NPOResident[];
  refusals: RefusalEntry[];
  onFortifyApply?: (id: string) => void;
}) {
  // Static hydration laggers — in production this would come from intake records
  const hydrationText =
    fortification.length > 0
      ? `${fortification[0].resident_name} · Add fluid-rich items to trays`
      : "No hydration alerts";

  return (
    <div className="w-[400px] shrink-0 border-l border-stone-800 bg-stone-950/40 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-800">
        <h2 className="text-sm font-semibold text-white">Resident Watch</h2>
        <p className="text-xs text-stone-500">Live · driven by clinical + caregiver charting</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Fortification ── */}
        {fortification.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Fortify Today</h3>
              <span className="text-[10px] text-stone-500">{fortification.length}</span>
            </div>
            <div className="space-y-2">
              {fortification.map((f) => (
                <div key={f.id} className="rounded-xl bg-amber-500/5 ring-1 ring-amber-500/30 p-3">
                  <div className="flex items-start justify-between mb-1.5">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {f.resident_name}
                        <span className="text-stone-500 font-mono text-xs ml-1">· {f.room}</span>
                      </div>
                      <div className="text-[11px] text-rose-300 flex items-center gap-1 mt-0.5">
                        <TrendingDown className="w-3 h-3" /> {f.trigger}
                      </div>
                    </div>
                    <span className="text-xs font-mono font-semibold text-amber-300">{f.cal} kcal</span>
                  </div>
                  <div className="text-xs text-stone-300 mt-1.5">{f.add}</div>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => onFortifyApply?.(f.id)}
                      className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-semibold transition"
                    >
                      Apply to meal
                    </button>
                    <button className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs transition">
                      Defer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── NPO / Hospital ── */}
        {npo.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <X className="w-4 h-4 text-rose-400" />
              <h3 className="text-xs font-semibold text-rose-300 uppercase tracking-wider">NPO / Hospital</h3>
              <span className="text-[10px] text-stone-500">{npo.length}</span>
            </div>
            <div className="space-y-1.5">
              {npo.map((n) => (
                <div key={n.resident_id} className="rounded-lg bg-rose-500/5 ring-1 ring-rose-500/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">
                      {n.name}
                      <span className="text-stone-500 font-mono text-xs ml-1">· {n.room}</span>
                    </div>
                    <span className="text-[10px] font-mono text-rose-300">until {n.until}</span>
                  </div>
                  <div className="text-[11px] text-stone-400 mt-0.5">{n.reason}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Recent Refusals ── */}
        {refusals.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-semibold text-sky-300 uppercase tracking-wider">Recent Refusals</h3>
              <span className="text-[10px] text-stone-500">{refusals.length}</span>
            </div>
            <div className="space-y-1.5">
              {refusals.map((r, i) => (
                <div key={i} className="rounded-lg bg-sky-500/5 ring-1 ring-sky-500/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">
                      {r.name}
                      <span className="text-stone-500 font-mono text-xs ml-1">· {r.room}</span>
                    </div>
                    <span className="text-[10px] font-mono text-stone-500">{r.at}</span>
                  </div>
                  <div className="text-[11px] text-stone-400 mt-0.5">
                    Refused: <span className="text-stone-200">{r.item}</span>
                  </div>
                  <div className="text-[11px] text-emerald-300 mt-0.5 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> Try: {r.suggest}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Hydration ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Droplet className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Hydration Watch</h3>
          </div>
          <div className="rounded-lg bg-cyan-500/5 ring-1 ring-cyan-500/30 p-3 text-[11px] text-stone-300 leading-relaxed">
            {hydrationText}
          </div>
        </section>

        {/* Empty state */}
        {fortification.length === 0 && npo.length === 0 && refusals.length === 0 && (
          <div className="text-center text-stone-600 text-xs py-10">
            All clear — no active watch items
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-stone-800 grid grid-cols-2 gap-2">
        <button className="rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium py-2.5 flex items-center justify-center gap-1.5 ring-1 ring-stone-700 transition">
          <Truck className="w-3.5 h-3.5" /> Vendor Order
        </button>
        <button className="rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium py-2.5 flex items-center justify-center gap-1.5 ring-1 ring-stone-700 transition">
          <FileText className="w-3.5 h-3.5" /> Survey Pack
        </button>
      </div>
    </div>
  );
}
