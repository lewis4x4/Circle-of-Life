"use client";

import {
  X,
  Pill,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ShieldCheck,
} from "lucide-react";
import type { ResidentItem } from "./ResidentRail";
import type { MedPassItem } from "./PassCard";

interface ResidentDrawerProps {
  resident: ResidentItem | null;
  passes: MedPassItem[];
  onClose: () => void;
}

const statusLabel: Record<string, { label: string; cls: string }> = {
  stable: { label: "Stable",     cls: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30" },
  watch:  { label: "Watch",      cls: "text-amber-300  bg-amber-500/10  ring-amber-500/30" },
  alert:  { label: "Alert",      cls: "text-rose-300   bg-rose-500/10   ring-rose-500/30" },
  hold:   { label: "Hold active",cls: "text-rose-300   bg-rose-500/10   ring-rose-500/30 animate-pulse" },
};

export function ResidentDrawer({ resident, passes, onClose }: ResidentDrawerProps) {
  if (!resident) return null;

  const residentPasses = passes.filter((p) =>
    p.resident.startsWith(resident.name.split(",")[0]),
  );
  const status = statusLabel[resident.status] ?? statusLabel.stable;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${status.cls}`}
              >
                {status.label}
              </span>
              {resident.room !== "-" && (
                <span className="text-xs font-mono text-slate-400">
                  Room {resident.room}
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold text-white">{resident.name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{resident.note}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Active holds */}
          {resident.status === "hold" && (
            <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-rose-300">Active Hold</h3>
              </div>
              <p className="text-xs text-rose-200 leading-relaxed">
                A hold is active on this resident. Review med passes and notify nurse before administering.
              </p>
            </div>
          )}

          {/* Upcoming meds */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Pill className="w-3.5 h-3.5" /> Med Passes This Shift
            </h3>
            {residentPasses.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> All passes complete
              </div>
            ) : (
              <div className="space-y-2">
                {residentPasses.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-xl p-3 ring-1 ${
                      p.status === "overdue"
                        ? "bg-rose-500/10 ring-rose-500/30"
                        : p.status === "hold"
                        ? "bg-rose-500/10 ring-rose-500/30"
                        : p.status === "due"
                        ? "bg-amber-500/10 ring-amber-500/30"
                        : "bg-slate-800/60 ring-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-mono text-white font-semibold">{p.time}</span>
                      {p.controlled && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-[10px] font-semibold ring-1 ring-violet-500/40">
                          <ShieldCheck className="w-3 h-3" /> C-II
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-white">{p.med}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{p.dose}</div>
                    {p.hold && (
                      <div className="mt-2 text-xs text-rose-300 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {p.hold}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Placeholder for chart link */}
          <div className="rounded-xl bg-slate-800/40 ring-1 ring-slate-700 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-300">Vitals</h3>
            </div>
            <p className="text-xs text-slate-500">
              Last charted vitals visible in full chart. Open admin view for complete history.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium ring-1 ring-slate-700 transition"
          >
            Close
          </button>
          <button className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
            <FileText className="w-4 h-4" /> Full Chart
          </button>
        </div>
      </div>
    </>
  );
}
