"use client";

import { useState } from "react";
import { ScanLine, ShieldAlert, CheckCircle2, Check, ChevronRight } from "lucide-react";
import { DIET_COLOR } from "./TrayCard";
import type { TrayTicket } from "./types";

const VENUE_LABEL: Record<string, string> = {
  main_dining: "Main Dining",
  memory_care: "Memory Care",
  room_trays: "Room Tray",
};

export function PassModal({
  ticket,
  onClose,
}: {
  ticket: TrayTicket | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0); // 0 scan, 1 iddsi, 2 confirm

  if (!ticket) return null;

  const steps = ["Scan tray", "IDDSI texture", "Confirm pass"];
  const allergenAlert = ticket.allergens.length > 0;
  const dietClass = DIET_COLOR[ticket.diet_label] ?? "bg-stone-700/60 text-stone-300 ring-stone-600";

  function handleClose() {
    setStep(0);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-stone-900 ring-1 ring-stone-700 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-stone-800 bg-gradient-to-r from-stone-900 to-stone-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-stone-400">
                Room {ticket.room} · {VENUE_LABEL[ticket.venue] ?? ticket.venue}
              </span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${dietClass}`}>
                {ticket.diet_label}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-200 text-[10px] font-bold ring-1 ring-violet-500/40 font-mono">
                IDDSI L{ticket.iddsi_level}
              </span>
            </div>
            <h2 className="text-xl font-semibold text-white">{ticket.resident_name}</h2>
            <p className="text-sm text-stone-400 mt-0.5">{ticket.menu_items.join(" · ")}</p>
          </div>
          <button onClick={handleClose} className="text-stone-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-3 flex gap-2 border-b border-stone-800">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition ${
                i <= step ? "bg-gradient-to-r from-amber-500 to-rose-500" : "bg-stone-800"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="p-6 min-h-[340px]">

          {/* Step 0: Scan */}
          {step === 0 && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="relative w-28 h-28 mb-5">
                <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                <div className="relative w-28 h-28 rounded-full bg-amber-500/10 ring-2 ring-amber-500/50 flex items-center justify-center">
                  <ScanLine className="w-14 h-14 text-amber-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-white">Scan tray card</h3>
              <p className="text-sm text-stone-400 mt-1 max-w-sm">
                Aim camera at the resident barcode on the tray card.
              </p>

              {allergenAlert && (
                <div className="mt-5 w-full rounded-xl bg-rose-500/10 ring-1 ring-rose-500/40 p-3 flex items-center gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                  <div className="text-left text-sm text-rose-200">
                    <span className="font-semibold">Allergen alert · </span>
                    {ticket.allergens.join(", ")} — verify no cross-contact
                  </div>
                </div>
              )}

              <button
                onClick={() => setStep(1)}
                className="mt-6 px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-semibold transition"
              >
                Simulate scan ✓
              </button>
            </div>
          )}

          {/* Step 1: IDDSI gate */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="w-5 h-5 text-violet-400" />
                <h3 className="text-sm font-semibold text-violet-300 uppercase tracking-wider">
                  IDDSI Gate · Required Level {ticket.iddsi_level}
                </h3>
              </div>
              <p className="text-sm text-stone-400 mb-4">Tap the photo that matches what&apos;s on the plate.</p>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { lvl: ticket.iddsi_level - 1, label: "Too smooth", correct: false },
                  { lvl: ticket.iddsi_level,     label: "Match",      correct: true  },
                  { lvl: ticket.iddsi_level + 1, label: "Too coarse", correct: false },
                ].map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => opt.correct && setStep(2)}
                    className={`aspect-square rounded-2xl ring-2 transition flex flex-col items-center justify-center gap-2 ${
                      opt.correct
                        ? "bg-emerald-500/10 ring-emerald-500/40 hover:ring-emerald-400"
                        : "bg-stone-800 ring-stone-700 hover:ring-rose-500/50"
                    }`}
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-700 to-orange-900 ring-2 ring-stone-700 shadow-inner" />
                    <div className="text-xs font-mono text-white">L{opt.lvl}</div>
                    <div className="text-[10px] text-stone-400">{opt.label}</div>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between text-xs">
                <button
                  onClick={() => setStep(2)}
                  className="text-stone-500 hover:text-stone-300 underline"
                >
                  Override (logged + nurse notified)
                </button>
                <span className="text-stone-500">Wrong texture = aspiration risk</span>
              </div>
            </div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && (
            <div>
              <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-emerald-200">All checks passed</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-200">
                    <Check className="w-3.5 h-3.5" /> Resident match
                  </div>
                  <div className="flex items-center gap-2 text-emerald-200">
                    <Check className="w-3.5 h-3.5" /> Diet compliant
                  </div>
                  <div className="flex items-center gap-2 text-emerald-200">
                    <Check className="w-3.5 h-3.5" /> IDDSI L{ticket.iddsi_level} confirmed
                  </div>
                  <div className="flex items-center gap-2 text-emerald-200">
                    <Check className="w-3.5 h-3.5" /> Allergens screened
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-stone-800/60 ring-1 ring-stone-700 p-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-2">Tray contents</div>
                <ul className="space-y-1.5">
                  {ticket.menu_items.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-white">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {item}
                    </li>
                  ))}
                  {ticket.fortification_items.map((item, i) => (
                    <li key={`f${i}`} className="flex items-center gap-2 text-sm text-amber-200">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> + {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClose}
                  className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-sm font-semibold transition flex items-center gap-2"
                >
                  Pass tray <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
