"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MedPassItem } from "@/components/med-tech/PassCard";
import type { ResidentItem } from "@/components/med-tech/ResidentRail";
import type { TapeEvent } from "@/components/med-tech/ShiftTape";
import type { ShiftBarProps } from "@/components/med-tech/ShiftBar";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

interface ShiftData {
  userId: string;
  shift: ShiftBarProps;
  passes: MedPassItem[];
  residents: ResidentItem[];
  tape: TapeEvent[];
  shiftId: string;
  loading: boolean;
  error: string | null;
}

function derivePassStatus(
  dbStatus: string,
  scheduledTime: string | null,
): { status: MedPassItem["status"]; minutes: number } {
  if (dbStatus === "given") return { status: "given", minutes: 0 };
  if (dbStatus === "held") return { status: "hold", minutes: 0 };
  if (dbStatus === "refused") return { status: "given", minutes: 0 };
  if (dbStatus === "missed") return { status: "overdue", minutes: -999 };
  if (!scheduledTime) return { status: "upcoming", minutes: 30 };
  const diffMin = Math.round((new Date(scheduledTime).getTime() - Date.now()) / 60000);
  if (diffMin < -2) return { status: "overdue", minutes: diffMin };
  if (diffMin <= 2) return { status: "due", minutes: 0 };
  return { status: "upcoming", minutes: diffMin };
}

function mapTapeKind(eventType: string): TapeEvent["kind"] {
  if (eventType.includes("clock")) return "shift";
  if (eventType.includes("given") || eventType.includes("pass")) return "pass";
  if (eventType.includes("vitals")) return "vitals";
  if (eventType.includes("hold")) return "hold";
  if (eventType.includes("page")) return "page";
  if (eventType.includes("prn")) return "prn";
  if (eventType.includes("incident")) return "incident";
  return "shift";
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function elapsed(clockedIn: string | null): string {
  if (!clockedIn) return "00:00";
  const diff = Date.now() - new Date(clockedIn).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Raw Supabase query helper — casts to bypass generated type depth issues */
async function q(table: string, select: string, filters: Record<string, any> = {}) {
  const sb = createClient();
  let query = (sb as any).from(table).select(select);
  for (const [k, v] of Object.entries(filters)) {
    if (k === "_order") { query = query.order(v.col, v.opts); continue; }
    if (k === "_limit") { query = query.limit(v); continue; }
    if (k === "_in") { query = query.in(v.col, v.vals); continue; }
    if (k === "_is") { query = query.is(v.col, v.val); continue; }
    if (k === "_single") { query = query.maybeSingle(); continue; }
    query = query.eq(k, v);
  }
  const { data, error } = await query;
  return { data: data as R[] | R | null, error };
}

export function useShiftCurrent(): ShiftData {
  const [data, setData] = useState<ShiftData>({
    userId: "",
    shift: { techName: "", techInitials: "", shiftLabel: "", unitLabel: "Oakridge ALF", assignedCount: 0, elapsedLabel: "00:00", shiftType: "day" },
    passes: [], residents: [], tape: [], shiftId: "", loading: true, error: null,
  });

  const load = useCallback(async () => {
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setData(d => ({ ...d, loading: false, error: "Not authenticated" })); return; }

      // Active shift
      const shiftRes = await q("med_tech_shifts", "*", {
        user_id: user.id, status: "active",
        _is: { col: "deleted_at", val: null },
        _order: { col: "shift_start", opts: { ascending: false } },
        _limit: 1, _single: true,
      });
      if (shiftRes.error) { setData(d => ({ ...d, loading: false, error: shiftRes.error.message })); return; }
      const shift = shiftRes.data as R | null;
      if (!shift) { setData(d => ({ ...d, loading: false, error: "No active shift" })); return; }

      // Profile
      const profRes = await q("user_profiles", "full_name", { id: user.id, _single: true });
      const fullName = (profRes.data as R)?.full_name ?? "Med Tech";
      const initials = fullName.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

      // Shift residents with resident details
      const srRes = await q("med_tech_shift_residents",
        "resident_id, priority, residents(id, first_name, last_name, preferred_name)",
        { shift_id: shift.id, _order: { col: "priority", opts: { ascending: true } } });
      const shiftResidents = (srRes.data ?? []) as R[];

      // Med passes with medication details
      const mpRes = await q("med_passes",
        "*, resident_medications(medication_name, strength, form, route, controlled_schedule)",
        { shift_id: shift.id, _is: { col: "deleted_at", val: null }, _order: { col: "scheduled_time", opts: { ascending: true } } });
      const passes = (mpRes.data ?? []) as R[];

      // Tape events
      const tRes = await q("shift_tape_events", "*",
        { shift_id: shift.id, _order: { col: "occurred_at", opts: { ascending: true } } });
      const tapeRows = (tRes.data ?? []) as R[];

      // Active holds
      const rids = shiftResidents.map(sr => sr.resident_id);
      const holdRes = await q("pre_pass_holds", "resident_id",
        { active: true, _in: { col: "resident_id", vals: rids } });
      const holdRids = new Set(((holdRes.data ?? []) as R[]).map(h => h.resident_id));

      // ── Build UI data ──

      const passItems: MedPassItem[] = passes
        .filter(p => p.status !== "given")
        .map(p => {
          const med = p.resident_medications as R | null;
          const { status, minutes } = derivePassStatus(p.status, p.scheduled_time);
          const sr = shiftResidents.find(s => s.resident_id === p.resident_id);
          const res = sr?.residents as R | null;
          const resName = res ? `${res.last_name}, ${res.preferred_name || res.first_name}` : "Unknown";
          return {
            id: p.id, resident: resName, room: "-",
            med: med ? `${med.medication_name} ${med.strength}` : "Unknown",
            dose: med ? `1 ${med.form} ${med.route}` : "",
            time: p.scheduled_time ? fmtTime(p.scheduled_time) : "--:--",
            status, minutes,
            controlled: med?.controlled_schedule !== "non_controlled" && med?.controlled_schedule != null,
            hold: p.hold_reason || null,
          } satisfies MedPassItem;
        })
        .sort((a, b) => {
          const ord: Record<string, number> = { overdue: 0, hold: 1, due: 2, upcoming: 3, given: 4 };
          return (ord[a.status] ?? 3) - (ord[b.status] ?? 3) || a.minutes - b.minutes;
        });

      const resItems: ResidentItem[] = shiftResidents.map(sr => {
        const res = sr.residents as R | null;
        const rid = sr.resident_id as string;
        const ln = (res?.last_name ?? "") as string;
        const hasHold = holdRids.has(rid);
        const hasOverdue = passItems.some(p => p.status === "overdue" && p.resident.startsWith(ln));
        let status: ResidentItem["status"] = "stable";
        if (hasHold) status = "hold";
        else if (hasOverdue) status = "alert";
        const nextPass = passItems.find(p => p.resident.startsWith(ln) && p.status !== "given");
        return {
          id: rid,
          name: res ? `${res.last_name}, ${((res.preferred_name || res.first_name) as string).charAt(0)}.` : "Unknown",
          room: "-",
          status,
          note: hasHold ? "Hold active" : hasOverdue ? `Overdue ${nextPass?.time ?? ""}` : nextPass ? `Next ${nextPass.time}` : "All clear",
        };
      });

      const tapeItems: TapeEvent[] = tapeRows.map(t => ({
        t: fmtTime(t.occurred_at), kind: mapTapeKind(t.event_type), text: t.summary,
      }));

      const startH = fmtTime(shift.shift_start);
      const endH = fmtTime(shift.shift_end);
      const isPM = new Date(shift.shift_start).getHours() >= 12;

      const shiftType = currentShiftForTimezone("America/New_York");
      setData({
        userId: user.id,
        shift: {
          techName: fullName, techInitials: initials,
          shiftLabel: `${isPM ? "PM" : "AM"} · ${startH} - ${endH}`,
          unitLabel: "Oakridge ALF",
          assignedCount: resItems.length,
          elapsedLabel: elapsed(shift.clocked_in_at),
          shiftType,
        },
        passes: passItems, residents: resItems, tape: tapeItems,
        shiftId: shift.id, loading: false, error: null,
      });
    } catch (err) {
      setData(d => ({ ...d, loading: false, error: err instanceof Error ? err.message : "Unknown error" }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return data;
}
