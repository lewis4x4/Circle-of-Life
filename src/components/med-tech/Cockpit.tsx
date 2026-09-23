"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { ShiftBar } from "./ShiftBar";
import { NowLane } from "./NowLane";
import { ResidentRail } from "./ResidentRail";
import { ShiftTape } from "./ShiftTape";
import { MedPassModal } from "./MedPassFlow/MedPassModal";
import { ResidentDrawer } from "./ResidentDrawer";
import { IncidentModal } from "./IncidentModal";
import type { MedPassItem } from "./PassCard";
import type { ResidentItem } from "./ResidentRail";
import { useShiftCurrent } from "@/hooks/med-tech/useShiftCurrent";

export function Cockpit() {
  const [activePass, setActivePass]         = useState<MedPassItem | null>(null);
  const [activeResident, setActiveResident] = useState<ResidentItem | null>(null);
  const [incidentOpen, setIncidentOpen]     = useState(false);

  const { userId, shift, passes, residents, tape, shiftId, shiftContext, loading, error, refresh } = useShiftCurrent();

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading shift data...
        </div>
      </div>
    );
  }

  if (error) {
    const noShift = error === "No active shift";
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div
          className={
            noShift
              ? "max-w-md rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center"
              : "max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-center"
          }
        >
          <h2
            className={
              noShift
                ? "text-lg font-semibold text-slate-200 mb-2"
                : "text-lg font-semibold text-rose-300 mb-2"
            }
          >
            {noShift ? "Cockpit is waiting on a shift" : "Shift Not Available"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {noShift
              ? "No med-tech shift is open for you, so there is no med pass to show here. Clocking in on the time clock opens your shift here; until then, work medications from the floor app."
              : error}
          </p>
          {noShift ? (
            // Med-techs hold the floor app since #671, including its time clock (COL-661 A7).
            <div className="mt-3 flex justify-center gap-4 text-sm">
              <Link href="/caregiver/clock" className="underline">Time clock</Link>
              <Link href="/caregiver/meds" className="underline">Medications</Link>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full text-white flex flex-col font-sans antialiased overflow-hidden">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-40 -right-40 w-96 h-96 rounded-full bg-sky-600/10 blur-3xl" />

      <ShiftBar {...shift} />

      <div className="px-4 pb-4 md:px-6">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 ">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <span>Medication Pass</span>
            <span className="text-slate-600">/</span>
            <span>{passes.length} due now</span>
            <span className="text-slate-600">/</span>
            <span>{residents.length} residents in rail</span>
            <span className="text-slate-600">/</span>
            <span>{tape.length} shift events</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Work the current pass queue first, keep resident context within reach, and capture exceptions without leaving the cockpit.
          </p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <NowLane passes={passes} onOpen={setActivePass} />
        <ResidentRail
          residents={residents}
          onResidentClick={setActiveResident}
          onIncidentClick={() => setIncidentOpen(true)}
        />
      </div>

      <ShiftTape events={tape} handoffTime="15:00" />

      {/* Med pass modal */}
      {activePass && (
        <MedPassModal pass={activePass} onClose={() => setActivePass(null)} onSaved={() => void refresh()} />
      )}

      {/* Resident chart drawer */}
      {activeResident && (
        <ResidentDrawer
          resident={activeResident}
          passes={passes}
          onClose={() => setActiveResident(null)}
        />
      )}

      {/* Incident capture modal */}
      {incidentOpen && (
        <IncidentModal
          userId={userId}
          shiftId={shiftId}
          shiftType={shift.shiftType}
          shiftContext={shiftContext}
          residents={residents}
          onClose={() => setIncidentOpen(false)}
        />
      )}
    </div>
  );
}
