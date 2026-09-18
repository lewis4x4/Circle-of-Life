/**
 * observation-escalation-engine: service-role Supabase adapter for EngineStore.
 *
 * Narrow selects rather than embedded joins, so the adapter does not depend on
 * PostgREST resolving foreign keys by name, and so only the columns the message
 * builder is allowed to see are ever read. The resident lookup reads a bed and
 * a room and nothing else: no name, no date of birth, no clinical field.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type {
  DeliveryPatch,
  DeliveryRow,
  DispatchContext,
  DueRungRow,
  EngineStore,
  FireResult,
} from "./engine.ts";

class StoreError extends Error {
  constructor(step: string, code: string | undefined) {
    super(`${step}${code ? ` (${code})` : ""}`);
    this.name = "StoreError";
  }
}

interface DispatchSelect {
  id: string;
  task_id: string;
  resident_id: string;
  escalation_rung_id: string;
}

interface RungSelect {
  id: string;
  label: string;
  protocol_text: string | null;
  assigned_staff_only: boolean;
}

interface ResidentSelect {
  id: string;
  bed_id: string | null;
}

export function supabaseStore(admin: SupabaseClient): EngineStore {
  return {
    async advanceLapse(organizationId, facilityId, atIso) {
      const { data, error } = await admin.rpc("advance_observation_task_lapse", {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_at: atIso,
      });
      if (error) throw new StoreError("advance lapse", error.code);
      return typeof data === "number" ? data : 0;
    },

    async loadDue(organizationId, facilityId, atIso, limit) {
      const { data, error } = await admin.rpc("observation_escalations_due", {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_at: atIso,
        p_limit: limit,
      });
      if (error) throw new StoreError("load due rungs", error.code);
      return (data ?? []) as DueRungRow[];
    },

    async fireRung(taskId, rungKey, atIso) {
      const { data, error } = await admin.rpc("record_observation_escalation_rung", {
        p_task_id: taskId,
        p_rung_key: rungKey,
        p_at: atIso,
      });
      if (error) throw new StoreError("fire rung", error.code);
      return (data ?? { fired: false, reason: "no_result" }) as FireResult;
    },

    /**
     * Claims deliveries for this tick's organization, and for its facility when
     * the tick names one, moving them to `sending` in the same statement that
     * returns them.
     *
     * This replaced an unscoped read that filtered on nothing but `queued` and
     * `send_after`. It selected organization_id and facility_id and filtered on
     * neither, so a per facility cron entry drained every queued push and SMS
     * across every facility and every tenant, and each body names a room and a
     * building. The scope is now the database's business rather than this
     * file's: the command has no default organization, so a caller that forgets
     * to pass one gets an error instead of everybody's messages.
     *
     * The claim is a status transition rather than a row lock because the send
     * happens over HTTP after this call returns, and a lock would be released at
     * commit while the provider call was still in flight.
     */
    async claimDeliveries(organizationId, facilityId, claimToken, nowIso, limit) {
      const { data, error } = await admin.rpc("claim_observation_escalation_deliveries", {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_claim_token: claimToken,
        p_at: nowIso,
        p_limit: limit,
      });
      if (error) throw new StoreError("claim deliveries", error.code);
      return (data ?? []) as DeliveryRow[];
    },

    async loadDispatchContexts(dispatchIds) {
      const out = new Map<string, DispatchContext>();
      if (dispatchIds.length === 0) return out;

      const { data: dispatchData, error: dispatchErr } = await admin
        .from("observation_escalation_dispatches")
        .select("id, task_id, resident_id, escalation_rung_id")
        .in("id", [...dispatchIds]);
      if (dispatchErr) throw new StoreError("load dispatches", dispatchErr.code);
      const dispatches = (dispatchData ?? []) as DispatchSelect[];
      if (dispatches.length === 0) return out;

      const rungIds = [...new Set(dispatches.map((d) => d.escalation_rung_id))];
      const { data: rungData, error: rungErr } = await admin
        .from("facility_escalation_rungs")
        .select("id, label, protocol_text, assigned_staff_only")
        .in("id", rungIds);
      if (rungErr) throw new StoreError("load rungs", rungErr.code);
      const rungs = new Map<string, RungSelect>();
      for (const rung of (rungData ?? []) as RungSelect[]) rungs.set(rung.id, rung);

      const residentIds = [...new Set(dispatches.map((d) => d.resident_id))];
      const { data: residentData, error: residentErr } = await admin
        .from("residents")
        .select("id, bed_id")
        .in("id", residentIds);
      if (residentErr) throw new StoreError("load residents", residentErr.code);
      const residents = (residentData ?? []) as ResidentSelect[];

      const bedIds = [...new Set(residents.map((r) => r.bed_id).filter((v): v is string => Boolean(v)))];
      const bedToRoom = new Map<string, string>();
      if (bedIds.length > 0) {
        const { data: beds, error: bedErr } = await admin.from("beds").select("id, room_id").in("id", bedIds);
        if (bedErr) throw new StoreError("load beds", bedErr.code);
        for (const bed of (beds ?? []) as { id: string; room_id: string | null }[]) {
          if (bed.room_id) bedToRoom.set(bed.id, bed.room_id);
        }
      }

      const roomIds = [...new Set(bedToRoom.values())];
      const roomNumbers = new Map<string, string>();
      if (roomIds.length > 0) {
        const { data: rooms, error: roomErr } = await admin.from("rooms").select("id, room_number").in("id", roomIds);
        if (roomErr) throw new StoreError("load rooms", roomErr.code);
        for (const room of (rooms ?? []) as { id: string; room_number: string | null }[]) {
          if (room.room_number) roomNumbers.set(room.id, room.room_number);
        }
      }

      const roomByResident = new Map<string, string | null>();
      for (const resident of residents) {
        const roomId = resident.bed_id ? bedToRoom.get(resident.bed_id) : undefined;
        roomByResident.set(resident.id, roomId ? roomNumbers.get(roomId) ?? null : null);
      }

      for (const dispatch of dispatches) {
        const rung = rungs.get(dispatch.escalation_rung_id);
        if (!rung) continue;
        out.set(dispatch.id, {
          taskId: dispatch.task_id,
          label: rung.label,
          protocolText: rung.protocol_text,
          isReminder: rung.assigned_staff_only,
          room: roomByResident.get(dispatch.resident_id) ?? null,
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

    /**
     * Records the outcome of one delivery, through a command rather than a
     * filtered update.
     *
     * The first version of the claim fix left this as
     * `.update(patch).eq("id", id).eq("status", "queued")`. The claim had just
     * moved the row to `sending`, so it matched zero rows, and PostgREST returns
     * no error for an update that matches nothing: the write succeeded silently,
     * the outcome was never recorded, and the stale claim reclaim sent the
     * message again every timeout interval. The guard and the claim have to be
     * one statement in one place, and a write that matches nothing has to raise.
     */
    async recordDeliveryOutcome(id, claimToken, patch: DeliveryPatch) {
      const { error } = await admin.rpc("record_observation_escalation_delivery_outcome", {
        p_delivery_id: id,
        p_claim_token: claimToken,
        p_status: patch.status,
        p_skip_reason: patch.skip_reason ?? null,
        p_provider_message_id: patch.provider_message_id ?? null,
        p_error_message: patch.error_message ?? null,
        p_sent_at: patch.sent_at ?? null,
      });
      if (error) throw new StoreError("record delivery outcome", error.code);
    },
  };
}
