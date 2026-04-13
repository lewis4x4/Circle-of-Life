"use client";

import { useState } from "react";

import { ShiftBar, type ShiftBarProps } from "./ShiftBar";
import { NowLane } from "./NowLane";
import { ResidentRail, type ResidentItem } from "./ResidentRail";
import { ShiftTape, type TapeEvent } from "./ShiftTape";
import { MedPassModal } from "./MedPassFlow/MedPassModal";
import type { MedPassItem } from "./PassCard";

// ──────────────────────────────────────────────────────────────────
// MOCK DATA — production will hydrate from useShiftCurrent()
// ──────────────────────────────────────────────────────────────────
const SHIFT: ShiftBarProps = {
  techName: "Maria Ochoa, CMT",
  techInitials: "MO",
  shiftLabel: "AM · 7:00 - 3:00",
  unitLabel: "Magnolia · Floor 2",
  assignedCount: 14,
  elapsedLabel: "02:14",
};

const PASSES: MedPassItem[] = [
  { id: "1", resident: "Alvarez, Rosa", room: "214", med: "Lisinopril 10mg", dose: "1 tab PO", time: "09:00", status: "overdue", minutes: -8, controlled: false, hold: null },
  { id: "2", resident: "Chen, William", room: "208", med: "Metformin 500mg", dose: "1 tab PO", time: "09:00", status: "due", minutes: 0, controlled: false, hold: null },
  { id: "3", resident: "Delacroix, Henri", room: "221", med: "Oxycodone 5mg", dose: "1 tab PO", time: "09:15", status: "upcoming", minutes: 7, controlled: true, hold: null },
  { id: "4", resident: "Park, Sunhee", room: "217", med: "Eliquis 5mg", dose: "1 tab PO", time: "09:15", status: "hold", minutes: 7, controlled: false, hold: "BP 88/52 at 07:45 · Nurse paged" },
  { id: "5", resident: "Mitchell, Betty", room: "203", med: "Atorvastatin 20mg", dose: "1 tab PO", time: "09:30", status: "upcoming", minutes: 22, controlled: false, hold: null },
  { id: "6", resident: "Yusuf, Amani", room: "219", med: "Insulin NovoLog", dose: "8u SC", time: "09:30", status: "upcoming", minutes: 22, controlled: false, hold: null },
];

const RESIDENTS: ResidentItem[] = [
  { id: "1", name: "Alvarez, R.", room: "214", status: "alert", note: "Overdue 09:00" },
  { id: "2", name: "Chen, W.", room: "208", status: "watch", note: "BG check due" },
  { id: "3", name: "Delacroix, H.", room: "221", status: "stable", note: "Next 09:15" },
  { id: "4", name: "Park, S.", room: "217", status: "hold", note: "Hold · low BP" },
  { id: "5", name: "Mitchell, B.", room: "203", status: "stable", note: "Next 09:30" },
  { id: "6", name: "Yusuf, A.", room: "219", status: "stable", note: "Next 09:30" },
  { id: "7", name: "Kowalski, T.", room: "212", status: "stable", note: "Next 10:00" },
  { id: "8", name: "Reyes, M.", room: "206", status: "watch", note: "Refused breakfast" },
  { id: "9", name: "Okonkwo, E.", room: "224", status: "stable", note: "Next 10:00" },
  { id: "10", name: "Singh, P.", room: "210", status: "stable", note: "Next 12:00" },
  { id: "11", name: "Hoffmann, L.", room: "225", status: "stable", note: "Next 12:00" },
  { id: "12", name: "Tanaka, K.", room: "201", status: "watch", note: "PRN request" },
];

const TAPE: TapeEvent[] = [
  { t: "07:02", kind: "shift", text: "Clocked in · 14 residents assigned" },
  { t: "07:18", kind: "pass", text: "Mitchell, B. · Metoprolol 25mg · given" },
  { t: "07:24", kind: "pass", text: "Kowalski, T. · Warfarin 2mg · given" },
  { t: "07:31", kind: "vitals", text: "Park, S. · BP 88/52 · flagged" },
  { t: "07:33", kind: "hold", text: "Hold placed · Park, S. · Eliquis" },
  { t: "07:34", kind: "page", text: "Nurse paged · Park, S. · low BP" },
  { t: "08:02", kind: "prn", text: "Tanaka, K. · PRN acetaminophen · given" },
  { t: "08:41", kind: "incident", text: "Reyes, M. · skin tear · classified" },
  { t: "08:55", kind: "pass", text: "Chen, W. · Atorvastatin · given" },
  { t: "09:08", kind: "pass", text: "Alvarez, R. · Lisinopril · IN PROGRESS" },
];

// ──────────────────────────────────────────────────────────────────
// COCKPIT ROOT
// ──────────────────────────────────────────────────────────────────
export function Cockpit() {
  const [activePass, setActivePass] = useState<MedPassItem | null>(null);

  return (
    <div className="h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col font-sans antialiased overflow-hidden">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-96 h-96 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-40 -right-40 w-96 h-96 rounded-full bg-sky-600/10 blur-3xl" />

      <ShiftBar {...SHIFT} />

      <div className="flex-1 flex min-h-0">
        <NowLane passes={PASSES} onOpen={setActivePass} />
        <ResidentRail residents={RESIDENTS} />
      </div>

      <ShiftTape events={TAPE} handoffTime="15:00" />

      {activePass && (
        <MedPassModal pass={activePass} onClose={() => setActivePass(null)} />
      )}
    </div>
  );
}
