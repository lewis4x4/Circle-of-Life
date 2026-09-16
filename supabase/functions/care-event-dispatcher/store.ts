/**
 * care-event-dispatcher: service-role Supabase adapter for DispatcherStore.
 *
 * Three narrow selects instead of one embedded join so the adapter does not
 * depend on PostgREST resolving the residents -> beds -> rooms foreign keys
 * by name. Only the columns the message builder is allowed to see are read.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { CareEventRow, DeliveryPatch, DeliveryRow, DispatcherStore, ResidentContext } from "./handler.ts";

class StoreError extends Error {
  constructor(step: string, code: string | undefined) {
    super(`${step}${code ? ` (${code})` : ""}`);
    this.name = "StoreError";
  }
}

interface ResidentSelect {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
}

interface BedSelect {
  id: string;
  room_id: string | null;
}

interface RoomSelect {
  id: string;
  room_number: string | null;
}

export function supabaseStore(admin: SupabaseClient): DispatcherStore {
  return {
    async loadQueuedDeliveries(nowIso, limit) {
      const { data, error } = await admin
        .from("care_event_deliveries")
        .select("id, organization_id, facility_id, care_event_id, escalation_step, target_role, target_user_id, target_phone, channel, send_after")
        .eq("status", "queued")
        .lte("send_after", nowIso)
        .order("send_after", { ascending: true })
        .limit(limit);
      if (error) throw new StoreError("load deliveries", error.code);
      return (data ?? []) as DeliveryRow[];
    },

    async loadCareEvents(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await admin
        .from("care_events")
        .select("id, resident_id, kind, final_level, status, deleted_at")
        .in("id", [...ids]);
      if (error) throw new StoreError("load care events", error.code);
      return (data ?? []) as CareEventRow[];
    },

    async loadResidentContexts(residentIds) {
      const out = new Map<string, ResidentContext>();
      if (residentIds.length === 0) return out;
      const { data: residents, error: rErr } = await admin
        .from("residents")
        .select("id, first_name, last_name, bed_id")
        .in("id", [...residentIds]);
      if (rErr) throw new StoreError("load residents", rErr.code);
      const residentRows = (residents ?? []) as ResidentSelect[];

      const bedIds = [...new Set(residentRows.map((r) => r.bed_id).filter((v): v is string => Boolean(v)))];
      const bedToRoom = new Map<string, string>();
      if (bedIds.length > 0) {
        const { data: beds, error: bErr } = await admin.from("beds").select("id, room_id").in("id", bedIds);
        if (bErr) throw new StoreError("load beds", bErr.code);
        for (const bed of (beds ?? []) as BedSelect[]) if (bed.room_id) bedToRoom.set(bed.id, bed.room_id);
      }

      const roomIds = [...new Set(bedToRoom.values())];
      const roomNumbers = new Map<string, string>();
      if (roomIds.length > 0) {
        const { data: rooms, error: roomErr } = await admin.from("rooms").select("id, room_number").in("id", roomIds);
        if (roomErr) throw new StoreError("load rooms", roomErr.code);
        for (const room of (rooms ?? []) as RoomSelect[]) if (room.room_number) roomNumbers.set(room.id, room.room_number);
      }

      for (const resident of residentRows) {
        const roomId = resident.bed_id ? bedToRoom.get(resident.bed_id) : undefined;
        out.set(resident.id, {
          firstName: resident.first_name,
          lastName: resident.last_name,
          room: roomId ? roomNumbers.get(roomId) ?? null : null,
        });
      }
      return out;
    },

    async loadUserPhones(userIds) {
      const out = new Map<string, string | null>();
      if (userIds.length === 0) return out;
      const { data, error } = await admin.from("user_profiles").select("id, phone").in("id", [...userIds]);
      if (error) throw new StoreError("load phones", error.code);
      for (const row of (data ?? []) as { id: string; phone: string | null }[]) out.set(row.id, row.phone);
      return out;
    },

    async updateDelivery(id, patch: DeliveryPatch) {
      const { error } = await admin.from("care_event_deliveries").update(patch).eq("id", id).eq("status", "queued");
      if (error) throw new StoreError("update delivery", error.code);
    },
  };
}
