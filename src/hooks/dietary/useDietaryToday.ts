"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  DietaryDeckState,
  TrayTicket,
  MealService,
  HACCPEntry,
  FortificationRec,
  NPOResident,
  RefusalEntry,
  VenueId,
  TicketStatus,
  MealPeriod,
  ServiceStatus,
} from "@/components/dietary/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

const EMPTY_BAR = {
  cook_name: "Lead Cook",
  cook_initials: "LC",
  facility_name: "Oakridge ALF",
  meal_period: "Lunch",
  scheduled_time: "11:30",
  countdown_min: 0,
  expected: 0,
  plated: 0,
  passed: 0,
  census_delta: {},
};

const EMPTY_STATE: DietaryDeckState = {
  services: [],
  tickets: [],
  haccp: [],
  fortification: [],
  npo: [],
  refusals: [],
  service_bar: EMPTY_BAR,
  loading: true,
  error: null,
};

/** Raw query helper — bypasses generated type depth */
async function q(
  table: string,
  select: string,
  filters: Record<string, any> = {},
) {
  const sb = createClient();
  let query = (sb as any).from(table).select(select);
  for (const [k, v] of Object.entries(filters)) {
    if (k === "_order") { query = query.order(v.col, v.opts); continue; }
    if (k === "_limit") { query = query.limit(v); continue; }
    if (k === "_gte")   { query = query.gte(v.col, v.val); continue; }
    if (k === "_lte")   { query = query.lte(v.col, v.val); continue; }
    if (k === "_in")    { query = query.in(v.col, v.vals); continue; }
    if (k === "_neq")   { query = query.neq(v.col, v.val); continue; }
    query = query.eq(k, v);
  }
  const { data, error } = await query;
  return { data: data as R[] | null, error };
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/New_York",
  });
}

function dietLabel(dietType: string): string {
  const map: Record<string, string> = {
    regular: "Regular",
    mechanical_soft: "Mech Soft",
    puree: "Puree",
    full_liquid: "Full Liquid",
    clear_liquid: "Clear Liquid",
    ncs: "NCS · 60g",
    low_sodium: "Low Sodium",
    renal: "Renal",
    gluten_free: "Gluten Free",
    lactose_free: "Lactose Free",
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    custom: "Custom",
  };
  return map[dietType] ?? dietType;
}

function countdownMin(scheduledStart: string): number {
  const diff = Math.round((new Date(scheduledStart).getTime() - Date.now()) / 60000);
  return Math.max(diff, 0);
}

function residentInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export function useDietaryToday(): DietaryDeckState {
  const [state, setState] = useState<DietaryDeckState>(EMPTY_STATE);

  const load = useCallback(async () => {
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        setState((s) => ({ ...s, loading: false, error: "Not authenticated" }));
        return;
      }

      // Get facility_id from user_facility_access
      const { data: facRows } = await q("user_facility_access", "facility_id, organization_id", {
        user_id: user.id,
        is_primary: true,
        _limit: 1,
      });
      const facilityId = (facRows?.[0] as R | undefined)?.facility_id as string | undefined;
      if (!facilityId) {
        setState((s) => ({ ...s, loading: false, error: "No facility assigned" }));
        return;
      }

      // User profile
      const { data: profRows } = await q("user_profiles", "full_name", {
        id: user.id, _limit: 1,
      });
      const fullName = (profRows?.[0] as R | undefined)?.full_name as string ?? "Lead Cook";
      const initials = residentInitials(fullName);

      // Today's date (facility timezone)
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

      // ── Meal services for today ──
      const { data: svcRows } = await q("meal_services",
        "id, venue, meal_period, scheduled_start, status, expected_count, served_count",
        {
          facility_id: facilityId,
          service_date: today,
          _order: { col: "scheduled_start", opts: { ascending: true } },
        },
      );

      const services: MealService[] = (svcRows ?? []).map((s) => ({
        id: s.id as string,
        venue: s.venue as VenueId,
        meal_period: s.meal_period as MealPeriod,
        scheduled_start: s.scheduled_start as string,
        status: s.status as ServiceStatus,
        expected_count: (s.expected_count as number) ?? 0,
        served_count: (s.served_count as number) ?? 0,
      }));

      const serviceIds = services.map((s) => s.id);

      // ── Tray tickets with resident join ──
      const tickets: TrayTicket[] = [];

      if (serviceIds.length > 0) {
        const { data: ticketRows } = await q(
          "tray_tickets",
          "id, meal_service_id, resident_id, diet_order_snapshot, menu_items, fortification_items, status, iddsi_confirmed_food, allergen_check_passed, carb_count_g, sodium_mg, calorie_count, residents(first_name, last_name, room_number)",
          {
            facility_id: facilityId,
            _in: { col: "meal_service_id", vals: serviceIds },
            _order: { col: "created_at", opts: { ascending: true } },
          },
        );

        for (const t of ticketRows ?? []) {
          const res = t.residents as R | null;
          const snap = (t.diet_order_snapshot as R) ?? {};
          const menuItems = Array.isArray(t.menu_items) ? t.menu_items as string[] : [];
          const fortItems = Array.isArray(t.fortification_items) ? t.fortification_items as string[] : [];
          const allergens = Array.isArray(snap.allergies) ? snap.allergies as string[] : [];
          const dietType = (snap.diet_type as string) ?? "regular";
          const iddsi = (snap.iddsi_food_level as number) ?? 7;

          // Map meal_service_id → venue
          const svc = services.find((s) => s.id === (t.meal_service_id as string));
          const venue: VenueId = svc?.venue ?? "main_dining";

          tickets.push({
            id: t.id as string,
            venue,
            meal_service_id: t.meal_service_id as string,
            resident_id: t.resident_id as string,
            resident_name: res
              ? `${(res.last_name as string)}, ${(res.first_name as string)}`
              : "Unknown",
            room: (res?.room_number as string | undefined) ?? "-",
            diet_type: dietType as TrayTicket["diet_type"],
            diet_label: dietLabel(dietType),
            iddsi_level: iddsi,
            allergens,
            status: (t.status as TicketStatus) ?? "queued",
            menu_items: menuItems,
            fortify: fortItems.length > 0,
            fortification_items: fortItems,
            carb_count_g: (t.carb_count_g as number | null) ?? null,
            sodium_mg: (t.sodium_mg as number | null) ?? null,
            calorie_count: (t.calorie_count as number | null) ?? null,
          });
        }
      }

      // ── HACCP logs for today ──
      const startOfDay = `${today}T00:00:00+00:00`;
      const { data: haccpRows } = await q("haccp_logs",
        "id, log_type, item, temperature_f, in_safe_range, logged_at, user_profiles!logged_by(full_name)",
        {
          facility_id: facilityId,
          _gte: { col: "logged_at", val: startOfDay },
          _order: { col: "logged_at", opts: { ascending: false } },
          _limit: 10,
        },
      );

      const haccp: HACCPEntry[] = (haccpRows ?? []).map((h) => {
        const prof = h["user_profiles!logged_by"] as R | null;
        return {
          id: h.id as string,
          time: fmtTime(h.logged_at as string),
          item: h.item as string,
          temperature_f: h.temperature_f as number,
          in_safe_range: h.in_safe_range as boolean,
          logged_by: (prof?.full_name as string | undefined)?.split(" ")[0] ?? "Staff",
          log_type: h.log_type as string,
        };
      });

      // ── Fortification recommendations (pending) ──
      const { data: fortRows } = await q("fortification_recommendations",
        "id, resident_id, trigger_evidence, recommended_items, estimated_added_calories, status, residents(first_name, last_name, room_number, diet_orders(diet_type))",
        {
          facility_id: facilityId,
          status: "pending",
          _order: { col: "created_at", opts: { ascending: false } },
          _limit: 5,
        },
      );

      const fortification: FortificationRec[] = (fortRows ?? []).map((f) => {
        const res = f.residents as R | null;
        const ev = (f.trigger_evidence as R) ?? {};
        const items = Array.isArray(f.recommended_items)
          ? (f.recommended_items as R[]).map((i) => i.item as string).join(" + ")
          : "";
        const cal = f.estimated_added_calories as number | null;
        const lossStr = ev.weight_loss_pct_30d
          ? `−${(ev.weight_loss_pct_30d as number).toFixed(1)}% / 30d`
          : ev.avg_intake_pct_7d
          ? `Intake ${(ev.avg_intake_pct_7d as number).toFixed(0)}% avg`
          : "Flagged";
        const doSnap = Array.isArray(res?.diet_orders) ? (res?.diet_orders as R[]) : [];
        const dt = doSnap[0]?.diet_type as string | undefined;

        return {
          id: f.id as string,
          resident_id: f.resident_id as string,
          resident_name: res
            ? `${(res.last_name as string)}, ${((res.first_name as string) ?? "").charAt(0)}.`
            : "Unknown",
          room: (res?.room_number as string | undefined) ?? "-",
          diet_type: dt ? dietLabel(dt) : "Regular",
          trigger: lossStr,
          add: items || "Supplement",
          cal: cal ? `+${cal}` : "+?",
          status: f.status as FortificationRec["status"],
        };
      });

      // ── NPO / Hospital residents (today's tickets with npo/hospital status) ──
      const npoTickets = tickets.filter((t) => t.status === "npo" || t.status === "hospital");
      const npo: NPOResident[] = npoTickets.map((t) => ({
        resident_id: t.resident_id,
        name: t.resident_name,
        room: t.room,
        reason: t.status === "hospital" ? "Hospital" : "NPO order",
        until: "TBD",
      }));

      // ── Refusals (last 24h) ──
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const { data: refusalRows } = await q("meal_refusals",
        "id, resident_id, refused_items, reason, refused_at, residents(first_name, last_name, room_number)",
        {
          facility_id: facilityId,
          _gte: { col: "refused_at", val: dayAgo },
          _order: { col: "refused_at", opts: { ascending: false } },
          _limit: 5,
        },
      );

      const refusals: RefusalEntry[] = (refusalRows ?? []).map((r) => {
        const res = r.residents as R | null;
        const items = Array.isArray(r.refused_items) ? (r.refused_items as string[]).join(", ") : "Item";
        const dt = new Date(r.refused_at as string);
        const isToday = dt.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === today;
        const atStr = isToday ? fmtTime(r.refused_at as string) : `yesterday ${fmtTime(r.refused_at as string)}`;
        return {
          resident_id: r.resident_id as string,
          name: res ? `${(res.last_name as string)}, ${((res.first_name as string) ?? "").charAt(0)}.` : "Unknown",
          room: (res?.room_number as string | undefined) ?? "-",
          item: items,
          suggest: "Alternate available",
          at: atStr,
        };
      });

      // ── Service bar data ──
      // Use the first active service as the primary context
      const primarySvc = services.find((s) =>
        s.status === "prep" || s.status === "plating" || s.status === "service",
      ) ?? services[0];

      const totalExpected = services.reduce((sum, s) => sum + s.expected_count, 0);
      const totalPlated = tickets.filter((t) =>
        ["plated", "passed", "delivered"].includes(t.status),
      ).length;
      const totalPassed = tickets.filter((t) =>
        ["passed", "delivered"].includes(t.status),
      ).length;

      const mealLabels: Record<string, string> = {
        breakfast: "Breakfast",
        lunch: "Lunch",
        dinner: "Dinner",
        snack_am: "AM Snack",
        snack_pm: "PM Snack",
        snack_hs: "HS Snack",
      };

      setState({
        services,
        tickets,
        haccp,
        fortification,
        npo,
        refusals,
        service_bar: {
          cook_name: fullName,
          cook_initials: initials,
          facility_name: "Oakridge ALF",
          meal_period: primarySvc ? mealLabels[primarySvc.meal_period] ?? "Service" : "Service",
          scheduled_time: primarySvc ? fmtTime(primarySvc.scheduled_start) : "--:--",
          countdown_min: primarySvc ? countdownMin(primarySvc.scheduled_start) : 0,
          expected: totalExpected,
          plated: totalPlated,
          passed: totalPassed,
          census_delta: {},
        },
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return state;
}
