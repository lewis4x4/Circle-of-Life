"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { formatBedAvailabilityRoomNumber } from "@/lib/facilities/bed-availability-display-copy";
import { createClient } from "@/lib/supabase/client";
import { classifyBeds, type ClassifiedBed } from "@/lib/stand-up/bed-classification";

export type FacilityBedAvailabilityRow = {
  id: string;
  room_id: string;
  room_number: string;
  bed_label: string;
  status: string;
  current_resident_id: string | null;
  /**
   * COL-374: the bed's Stand Up place, derived from who is in the room now by
   * the same rule the Stand Up form is checked against. Null for a bed whose
   * room Haven does not hold.
   */
  classification: ClassifiedBed | null;
  is_temporarily_blocked: boolean;
  blocked_reason: string | null;
};

type QueryError = { message: string };

export function useFacilityBedAvailability(
  facilityId: string,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const supabase = useMemo(() => createClient(), []);
  const { appRole } = useHavenAuth();
  const [rows, setRows] = useState<FacilityBedAvailabilityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = appRole === "owner" || appRole === "org_admin";

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const bedsRes = (await supabase
        .from("beds" as never)
        .select("id, room_id, bed_label, status, current_resident_id, is_temporarily_blocked, blocked_reason")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("bed_label", { ascending: true })) as unknown as {
        data: Array<{
          id: string;
          room_id: string;
          bed_label: string;
          status: string;
          current_resident_id: string | null;
          is_temporarily_blocked: boolean | null;
          blocked_reason: string | null;
        }> | null;
        error: QueryError | null;
      };
      if (bedsRes.error) throw bedsRes.error;

      const roomIds = Array.from(new Set((bedsRes.data ?? []).map((row) => row.room_id).filter(Boolean)));
      const roomsRes = roomIds.length
        ? ((await supabase
            .from("rooms" as never)
            .select("id, room_number, room_type")
            .in("id", roomIds)
            .is("deleted_at", null)) as unknown as {
            data: Array<{ id: string; room_number: string; room_type: string | null }> | null;
            error: QueryError | null;
          })
        : { data: [], error: null };
      if (roomsRes.error) throw roomsRes.error;

      // Who holds or is reserved for each bed decides its category; no names are read.
      const residentsRes = (await supabase
        .from("residents" as never)
        .select("id, bed_id, status, gender")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)) as unknown as {
        data: Array<{ id: string; bed_id: string | null; status: string | null; gender: string | null }> | null;
        error: QueryError | null;
      };
      if (residentsRes.error) throw residentsRes.error;
      const classified = classifyBeds(
        (bedsRes.data ?? []).map((row) => ({ id: row.id, room_id: row.room_id, status: row.status, current_resident_id: row.current_resident_id, is_temporarily_blocked: row.is_temporarily_blocked })),
        roomsRes.data ?? [],
        residentsRes.data ?? [],
      );

      const roomById = new Map((roomsRes.data ?? []).map((row) => [row.id, row.room_number] as const));
      setRows(
        (bedsRes.data ?? [])
          .map((row) => ({
            id: row.id,
            room_id: row.room_id,
            room_number: formatBedAvailabilityRoomNumber(roomById.get(row.room_id)),
            bed_label: row.bed_label,
            status: row.status,
            current_resident_id: row.current_resident_id,
            classification: classified.get(row.id) ?? null,
            is_temporarily_blocked: Boolean(row.is_temporarily_blocked),
            blocked_reason: row.blocked_reason,
          }))
          .sort((a, b) => {
            const roomCmp = String(a.room_number).localeCompare(String(b.room_number), undefined, {
              numeric: true,
              sensitivity: "base",
            });
            if (roomCmp !== 0) return roomCmp;
            return String(a.bed_label).localeCompare(String(b.bed_label), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load bed availability.");
    } finally {
      setIsLoading(false);
    }
  }, [facilityId, supabase]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    void load();
  }, [enabled, load]);

  const updateBed = useCallback(
    async (
      bedId: string,
      patch: Partial<Pick<FacilityBedAvailabilityRow, "is_temporarily_blocked" | "blocked_reason">>,
    ) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = (await supabase
          .from("beds" as never)
          .update({
            is_temporarily_blocked: patch.is_temporarily_blocked,
            blocked_reason: patch.blocked_reason,
          } as never)
          .eq("id", bedId)) as unknown as { error: QueryError | null };
        if (res.error) throw res.error;
        await load();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Could not save bed availability.");
      } finally {
        setIsSaving(false);
      }
    },
    [load, supabase],
  );

  return { rows, isLoading, error, isSaving, canEdit, updateBed, refetch: load };
}
