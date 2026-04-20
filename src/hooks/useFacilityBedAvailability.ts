"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useHavenAuth } from "@/contexts/haven-auth-context";

export type FacilityBedAvailabilityRow = {
  id: string;
  room_id: string;
  room_number: string;
  bed_label: string;
  status: string;
  current_resident_id: string | null;
  standup_availability_class: "private" | "sp_female" | "sp_male" | "sp_flexible" | null;
  is_temporarily_blocked: boolean;
  blocked_reason: string | null;
};

type QueryError = { message: string };

export function useFacilityBedAvailability(facilityId: string) {
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
        .select("id, room_id, bed_label, status, current_resident_id, standup_availability_class, is_temporarily_blocked, blocked_reason")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("bed_label", { ascending: true })) as unknown as {
        data: Array<{
          id: string;
          room_id: string;
          bed_label: string;
          status: string;
          current_resident_id: string | null;
          standup_availability_class: FacilityBedAvailabilityRow["standup_availability_class"];
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
            .select("id, room_number")
            .in("id", roomIds)
            .is("deleted_at", null)) as unknown as {
            data: Array<{ id: string; room_number: string }> | null;
            error: QueryError | null;
          })
        : { data: [], error: null };
      if (roomsRes.error) throw roomsRes.error;

      const roomById = new Map((roomsRes.data ?? []).map((row) => [row.id, row.room_number] as const));
      setRows(
        (bedsRes.data ?? [])
          .map((row) => ({
            id: row.id,
            room_id: row.room_id,
            room_number: roomById.get(row.room_id) ?? "—",
            bed_label: row.bed_label,
            status: row.status,
            current_resident_id: row.current_resident_id,
            standup_availability_class: row.standup_availability_class,
            is_temporarily_blocked: Boolean(row.is_temporarily_blocked),
            blocked_reason: row.blocked_reason,
          }))
          .sort((a, b) => `${a.room_number}-${a.bed_label}`.localeCompare(`${b.room_number}-${b.bed_label}`)),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load bed availability.");
    } finally {
      setIsLoading(false);
    }
  }, [facilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBed = useCallback(
    async (
      bedId: string,
      patch: Partial<Pick<FacilityBedAvailabilityRow, "standup_availability_class" | "is_temporarily_blocked" | "blocked_reason">>,
    ) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = (await supabase
          .from("beds" as never)
          .update({
            standup_availability_class: patch.standup_availability_class,
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
