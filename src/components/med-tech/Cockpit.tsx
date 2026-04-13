"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { ShiftBar } from "./ShiftBar";
import { NowLane } from "./NowLane";
import { ResidentRail } from "./ResidentRail";
import { ShiftTape } from "./ShiftTape";
import { MedPassModal } from "./MedPassFlow/MedPassModal";
import type { MedPassItem } from "./PassCard";
import { useShiftCurrent } from "@/hooks/med-tech/useShiftCurrent";

export function Cockpit() {
  const [activePass, setActivePass] = useState<MedPassItem | null>(null);
  const { shift, passes, residents, tape, loading, error } = useShiftCurrent();

  if (loading) {
    return (
      <div className="h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
          Loading shift data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-center">
          <h2 className="text-lg font-semibold text-rose-300 mb-2">
            Shift Not Available
          </h2>
          <p className="text-sm text-slate-400">
            {error === "No active shift"
              ? "No active shift found. Clock in from the scheduling system to start your shift."
              : error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col font-sans antialiased overflow-hidden">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-96 h-96 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-40 -right-40 w-96 h-96 rounded-full bg-sky-600/10 blur-3xl" />

      <ShiftBar {...shift} />

      <div className="flex-1 flex min-h-0">
        <NowLane passes={passes} onOpen={setActivePass} />
        <ResidentRail residents={residents} />
      </div>

      <ShiftTape events={tape} handoffTime="15:00" />

      {activePass && (
        <MedPassModal pass={activePass} onClose={() => setActivePass(null)} />
      )}
    </div>
  );
}
