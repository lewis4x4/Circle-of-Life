"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MedPassItem } from "@/components/med-tech/PassCard";
import type { ResidentItem } from "@/components/med-tech/ResidentRail";
import type { TapeEvent } from "@/components/med-tech/ShiftTape";
import type { ShiftBarProps } from "@/components/med-tech/ShiftBar";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import {
  formatShiftCurrentMedicationLabel,
  formatShiftCurrentResidentCompactName,
  formatShiftCurrentResidentName,
  formatShiftCurrentRoomLabel,
} from "@/lib/med-tech/shift-current-display-copy";

type QueryRow = Record<string, unknown>;
type QueryOrder = { col: string; opts?: Record<string, unknown> };
type QueryColumnValue = { col: string; val: unknown };
type QueryColumnValues = { col: string; vals: readonly unknown[] };
type QueryFilters = Record<string, unknown> & {
  _order?: QueryOrder;
  _limit?: number;
  _in?: QueryColumnValues;
  _is?: QueryColumnValue;
  _single?: boolean;
};
type QueryResult = { data: unknown; error: { message?: string } | null };
type DynamicQuery = PromiseLike<QueryResult> & {
  order(col: string, opts?: Record<string, unknown>): DynamicQuery;
  limit(count: number): DynamicQuery;
  in(col: string, vals: readonly unknown[]): DynamicQuery;
  is(col: string, val: unknown): DynamicQuery;
  maybeSingle(): DynamicQuery;
  eq(col: string, val: unknown): DynamicQuery;
};
type DynamicSupabase = {
  from(table: string): {
    select(columns: string): DynamicQuery;
  };
};

const UNRESOLVED_UNIT_LABEL = "Assigned facility";

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

function facilityLabelFrom(row: QueryRow | null | undefined): string {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  return name || UNRESOLVED_UNIT_LABEL;
}

/** Raw Supabase query helper — casts to bypass generated type depth issues */
async function q(table: string, select: string, filters: QueryFilters = {}) {
  const sb = createClient();
  const { _order, _limit, _in, _is, _single, ...eqFilters } = filters;
  let query = (sb as unknown as DynamicSupabase).from(table).select(select);
  if (_order) query = query.order(_order.col, _order.opts);
  if (typeof _limit === "number") query = query.limit(_limit);
  if (_in) query = query.in(_in.col, _in.vals);
  if (_is) query = query.is(_is.col, _is.val);
  if (_single) query = query.maybeSingle();
  for (const [k, v] of Object.entries(eqFilters)) {
    query = query.eq(k, v);
  }
  const { data, error } = await query;
  return { data: data as QueryRow[] | QueryRow | null, error };
}

export function useShiftCurrent(): ShiftData {
  const [data, setData] = useState<ShiftData>({
    userId: "",
    shift: { techName: "", techInitials: "", shiftLabel: "", unitLabel: UNRESOLVED_UNIT_LABEL, assignedCount: 0, elapsedLabel: "00:00", shiftType: "day" },
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
      if (shiftRes.error) {
        const errorMessage = shiftRes.error.message ?? "Failed to load active shift";
        setData(d => ({ ...d, loading: false, error: errorMessage }));
        return;
      }
      const shift = shiftRes.data as QueryRow | null;
      if (!shift) { setData(d => ({ ...d, loading: false, error: "No active shift" })); return; }

      const facilityRes = shift.facility_id
        ? await q("facilities", "name", { id: shift.facility_id, _single: true })
        : { data: null };
      const facilityLabel = facilityLabelFrom(facilityRes.data as QueryRow | null);

      // Profile
      const profRes = await q("user_profiles", "full_name", { id: user.id, _single: true });
      const fullName = ((profRes.data as QueryRow | null)?.full_name as string | undefined) ?? "Med Tech";
      const initials = fullName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

      // Shift residents with resident details
      const srRes = await q("med_tech_shift_residents",
        "resident_id, priority, residents(id, first_name, last_name, preferred_name)",
        { shift_id: shift.id, _order: { col: "priority", opts: { ascending: true } } });
      const shiftResidents = (srRes.data ?? []) as QueryRow[];

      // Med passes with medication details
      const mpRes = await q("med_passes",
        "*, resident_medications(medication_name, strength, form, route, controlled_schedule)",
        { shift_id: shift.id, _is: { col: "deleted_at", val: null }, _order: { col: "scheduled_time", opts: { ascending: true } } });
      const passes = (mpRes.data ?? []) as QueryRow[];

      // Tape events
      const tRes = await q("shift_tape_events", "*",
        { shift_id: shift.id, _order: { col: "occurred_at", opts: { ascending: true } } });
      const tapeRows = (tRes.data ?? []) as QueryRow[];

      // Active holds
      const rids = shiftResidents.map(sr => sr.resident_id);
      const holdRes = await q("pre_pass_holds", "resident_id",
        { active: true, _in: { col: "resident_id", vals: rids } });
      const holdRids = new Set(((holdRes.data ?? []) as QueryRow[]).map(h => h.resident_id));

      // ── Build UI data ──

      const passItems: MedPassItem[] = passes
        .filter(p => p.status !== "given")
        .map(p => {
          const med = p.resident_medications as QueryRow | null;
          const { status, minutes } = derivePassStatus(p.status as string, p.scheduled_time as string | null);
          const sr = shiftResidents.find(s => s.resident_id === p.resident_id);
          const res = sr?.residents as QueryRow | null;
          const resName = formatShiftCurrentResidentName(
            res
              ? {
                  first_name: (res.first_name as string | null) ?? null,
                  last_name: (res.last_name as string | null) ?? null,
                  preferred_name: (res.preferred_name as string | null) ?? null,
                }
              : null,
          );
          return {
            id: p.id as string,
            resident: resName,
            room: formatShiftCurrentRoomLabel(null),
            med: formatShiftCurrentMedicationLabel(
              med
                ? {
                    medication_name: (med.medication_name as string | null) ?? null,
                    strength: (med.strength as string | null) ?? null,
                  }
                : null,
            ),
            dose: med ? `1 ${med.form} ${med.route}` : "",
            time: p.scheduled_time ? fmtTime(p.scheduled_time as string) : "--:--",
            status, minutes,
            controlled: med?.controlled_schedule !== "non_controlled" && med?.controlled_schedule != null,
            hold: (p.hold_reason as string | null) || null,
          } satisfies MedPassItem;
        })
        .sort((a, b) => {
          const ord: Record<string, number> = { overdue: 0, hold: 1, due: 2, upcoming: 3, given: 4 };
          return (ord[a.status] ?? 3) - (ord[b.status] ?? 3) || a.minutes - b.minutes;
        });

      const resItems: ResidentItem[] = shiftResidents.map(sr => {
        const res = sr.residents as QueryRow | null;
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
          name: formatShiftCurrentResidentCompactName(
            res
              ? {
                  first_name: (res.first_name as string | null) ?? null,
                  last_name: (res.last_name as string | null) ?? null,
                  preferred_name: (res.preferred_name as string | null) ?? null,
                }
              : null,
          ),
          room: formatShiftCurrentRoomLabel(null),
          status,
          note: hasHold ? "Hold active" : hasOverdue ? `Overdue ${nextPass?.time ?? ""}` : nextPass ? `Next ${nextPass.time}` : "All clear",
        };
      });

      const tapeItems: TapeEvent[] = tapeRows.map(t => ({
        t: fmtTime(t.occurred_at as string),
        kind: mapTapeKind(t.event_type as string),
        text: t.summary as string,
      }));

      const startH = fmtTime(shift.shift_start as string);
      const endH = fmtTime(shift.shift_end as string);
      const isPM = new Date(shift.shift_start as string).getHours() >= 12;

      const shiftType = currentShiftForTimezone("America/New_York");
      setData({
        userId: user.id,
        shift: {
          techName: fullName, techInitials: initials,
          shiftLabel: `${isPM ? "PM" : "AM"} · ${startH} - ${endH}`,
          unitLabel: facilityLabel,
          assignedCount: resItems.length,
          elapsedLabel: elapsed(shift.clocked_in_at as string | null),
          shiftType,
        },
        passes: passItems, residents: resItems, tape: tapeItems,
        shiftId: shift.id as string, loading: false, error: null,
      });
    } catch (err) {
      setData(d => ({ ...d, loading: false, error: err instanceof Error ? err.message : "Unknown error" }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return data;
}
