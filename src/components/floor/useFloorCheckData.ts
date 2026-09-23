"use client";

import { fetchFloorCensus, fetchFloorTasks } from "@/lib/floor/floor-data";
import { residentNameOf, type FloorTaskApiRow } from "@/lib/floor/now-rows";
import { readFloorCache, writeFloorCache } from "@/lib/floor/memory-cache";
import { fetchLocationChips } from "@/lib/care-events/report-data";
import type { ObservationVocabOption } from "@/lib/rounding/observation-chips";

import { useFloorSession } from "./FloorContext";
import { useFloorQuery } from "./useFloorQuery";

export type FloorCheckData = {
  task: FloorTaskApiRow;
  residentId: string;
  residentName: string;
  room: string | null;
  gender: string | null;
  locations: ObservationVocabOption[];
};


/** The check, its resident (room, recorded gender for the questions) and the facility's location chips. */
export function useFloorCheckData(taskId: string) {
  const { supabase, facility } = useFloorSession();
  const facilityId = facility.facilityId;
  return useFloorQuery<FloorCheckData | null>(
    `check:${taskId}`,
    async () => {
      const [rows, locations] = await Promise.all([
        fetchFloorTasks({ facilityId, taskId }),
        // The same six in-building places the report flow offers (observation_vocab, no out-of-facility codes).
        fetchLocationChips(supabase, facilityId)
          .then((chips) => chips.map((chip) => ({ code: chip.code, label: chip.label })))
          .catch(() => [] as ObservationVocabOption[]),
      ]);
      const task = rows[0];
      const residentId = task?.residents?.id;
      if (!task || !residentId) return null;
      const censusKey = `census:${facilityId}`;
      let census = readFloorCache<Awaited<ReturnType<typeof fetchFloorCensus>>>(censusKey, 5 * 60_000);
      if (!census) {
        census = await fetchFloorCensus(supabase, facilityId);
        writeFloorCache(censusKey, census);
      }
      const { data: resident } = await supabase.from("residents").select("gender").eq("id", residentId).maybeSingle();
      return {
        task,
        residentId,
        residentName: residentNameOf(task.residents),
        room: census.find((row) => row.id === residentId)?.room ?? null,
        gender: resident?.gender ?? null,
        locations,
      };
    },
    5_000,
  );
}
