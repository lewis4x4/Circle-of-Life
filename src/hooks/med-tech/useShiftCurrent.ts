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
  _gte?: QueryColumnValue;
  _gt?: QueryColumnValue;
  _lte?: QueryColumnValue;
  _lt?: QueryColumnValue;
};
type QueryResult = { data: unknown; error: { message?: string } | null };
type DynamicQuery = PromiseLike<QueryResult> & {
  order(col: string, opts?: Record<string, unknown>): DynamicQuery;
  limit(count: number): DynamicQuery;
  in(col: string, vals: readonly unknown[]): DynamicQuery;
  is(col: string, val: unknown): DynamicQuery;
  maybeSingle(): DynamicQuery;
  eq(col: string, val: unknown): DynamicQuery;
  gte(col: string, val: unknown): DynamicQuery;
  gt(col: string, val: unknown): DynamicQuery;
  lte(col: string, val: unknown): DynamicQuery;
  lt(col: string, val: unknown): DynamicQuery;
  range(from: number, to: number): DynamicQuery;
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
  handoffTime: string;
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
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
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
  const { _order, _limit, _in, _is, _single, _gte, _gt, _lte, _lt, ...eqFilters } = filters;
  const build = () => {
    let query = (sb as unknown as DynamicSupabase).from(table).select(select);
    if (_order) query = query.order(_order.col, _order.opts);
    query = query.order("id", { ascending: true });
    if (typeof _limit === "number") query = query.limit(_limit);
    if (_in) query = query.in(_in.col, _in.vals);
    if (_is) query = query.is(_is.col, _is.val);
    if (_gte) query = query.gte(_gte.col, _gte.val);
    if (_gt) query = query.gt(_gt.col, _gt.val);
    if (_lte) query = query.lte(_lte.col, _lte.val);
    if (_lt) query = query.lt(_lt.col, _lt.val);
    for (const [key, value] of Object.entries(eqFilters)) query = query.eq(key, value);
    return query;
  };
  if (_single) return await build().maybeSingle();
  if (typeof _limit === "number") return await build();
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await build().range(offset, offset + 499);
    if (page.error) return { data: null, error: page.error };
    if (!Array.isArray(page.data)) throw new Error("Medication shift data was not returned");
    rows.push(...page.data);
    if (page.data.length < 500) return { data: rows, error: null };
  }
}

// Bound request URLs as well as response pages for large clinical queues.
async function qForIds(table: string, columns: string, filters: QueryFilters, column: string, ids: readonly unknown[]): Promise<QueryResult> {
  const results = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
    q(table, columns, { ...filters, _in: { col: column, vals: ids.slice(index * 100, (index + 1) * 100) } }),
  ));
  const failed = results.find(result => result.error);
  if (failed) return failed;
  return { data: results.flatMap(result => Array.isArray(result.data) ? result.data : []), error: null };
}

export function useShiftCurrent(): ShiftData & { refresh: () => Promise<void> } {
  const [data, setData] = useState<ShiftData>({
    userId: "",
    shift: { techName: "", techInitials: "", shiftLabel: "", unitLabel: UNRESOLVED_UNIT_LABEL, assignedCount: 0, elapsedLabel: "00:00", shiftType: "day" },
    passes: [], residents: [], tape: [], shiftId: "", handoffTime: "", loading: true, error: null,
  });

  const load = useCallback(async () => {
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setData(d => ({ ...d, loading: false, error: "Not authenticated" })); return; }

      // Active shift
      const shiftRes = await q("med_tech_shifts", "*", {
        user_id: user.id, status: "active",
        _lte: { col: "shift_start", val: new Date().toISOString() },
        _gt: { col: "shift_end", val: new Date().toISOString() },
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
      if (!facilityRes.data || ("error" in facilityRes && facilityRes.error)) throw new Error("Current facility access is unavailable. Refresh your session or contact an administrator.");
      const facilityLabel = facilityLabelFrom(facilityRes.data as QueryRow | null);

      // Profile
      const profRes = await q("user_profiles", "full_name", { id: user.id, _single: true });
      const fullName = ((profRes.data as QueryRow | null)?.full_name as string | undefined) ?? "Med Tech";
      const initials = fullName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

      // Shift residents with resident details
      const srRes = await q("med_tech_shift_residents",
        "resident_id, priority, residents(id, first_name, last_name, preferred_name, status, facility_id, deleted_at)",
        { shift_id: shift.id, _order: { col: "priority", opts: { ascending: true } } });
      if (srRes.error) throw new Error(srRes.error.message ?? "Resident assignments unavailable");
      const shiftResidents = ((srRes.data ?? []) as QueryRow[]).filter(row => {
        const resident = row.residents as QueryRow | null;
        return resident?.status === "active" && resident.facility_id === shift.facility_id && !resident.deleted_at;
      });

      // Med passes with medication details
      const mpRes = await q("med_passes",
        "*, resident_medications(medication_name, strength, form, route, instructions, controlled_schedule, witness_required, status, deleted_at)",
        { shift_id: shift.id, _is: { col: "deleted_at", val: null }, _order: { col: "scheduled_time", opts: { ascending: true } } });
      if (mpRes.error) throw new Error(mpRes.error.message ?? "Medication pass data unavailable");
      const passes = (mpRes.data ?? []) as QueryRow[];
      const medicationIds = [...new Set(passes.map(pass => pass.resident_medication_id))];
      const emar = await qForIds("emar_records", "resident_medication_id,scheduled_time,status", {
        facility_id: shift.facility_id,
        _is: { col: "deleted_at", val: null },
        _gte: { col: "scheduled_time", val: shift.shift_start },
        _lt: { col: "scheduled_time", val: shift.shift_end },
      }, "resident_medication_id", medicationIds);
      if (emar.error) throw new Error(emar.error.message ?? "Dose status unavailable");
      const doseKey = (row: QueryRow) => `${row.resident_medication_id}|${row.scheduled_time ? new Date(row.scheduled_time as string).toISOString() : ""}`;
      const documented = new Set(((emar.data ?? []) as QueryRow[]).filter(row => row.status !== "scheduled").map(doseKey));

      // Tape events
      const tRes = await q("shift_tape_events", "*",
        { shift_id: shift.id, _order: { col: "occurred_at", opts: { ascending: true } } });
      if (tRes.error) throw new Error(tRes.error.message ?? "Shift history unavailable");
      const tapeRows = (tRes.data ?? []) as QueryRow[];

      // Active holds
      const rids = shiftResidents.map(sr => sr.resident_id);
      const holdRes = await qForIds("pre_pass_holds", "resident_id",
        { active: true }, "resident_id", rids);
      if (holdRes.error) throw new Error(holdRes.error.message ?? "Hold status unavailable");
      const holdRids = new Set(((holdRes.data ?? []) as QueryRow[]).map(h => h.resident_id));

      // ── Build UI data ──

      const passItems: MedPassItem[] = passes
        .filter(p => {
          const med = p.resident_medications as QueryRow | null;
          return (p.status === "pending" || p.status === "overdue") && med?.status === "active" && !med.deleted_at
            && shiftResidents.some(row => row.resident_id === p.resident_id) && !documented.has(doseKey(p));
        })
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
            residentId: p.resident_id as string,
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
            dose: typeof med?.instructions === "string" ? med.instructions : "Review current order instructions",
            time: p.scheduled_time ? fmtTime(p.scheduled_time as string) : "--:--",
            status, minutes,
            witnessRequired: Boolean(p.witness_required || med?.witness_required),
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
        const hasHold = holdRids.has(rid);
        const hasOverdue = passItems.some(p => p.status === "overdue" && p.residentId === rid);
        let status: ResidentItem["status"] = "stable";
        if (hasHold) status = "hold";
        else if (hasOverdue) status = "alert";
        const nextPass = passItems.find(p => p.residentId === rid && p.status !== "given");
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
          note: hasHold ? "Hold active" : hasOverdue ? `Overdue ${nextPass?.time ?? ""}` : nextPass ? `Next ${nextPass.time}` : "No pending passes",
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
        shiftId: shift.id as string, handoffTime: endH, loading: false, error: null,
      });
    } catch (err) {
      setData(d => ({ ...d, loading: false, error: err instanceof Error ? err.message : "Unknown error" }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { ...data, refresh: load };
}
