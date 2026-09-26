"use client";

import { fetchFloorCensus, fetchFloorCheckVocab, fetchFloorTasks } from "@/lib/floor/floor-data";
import { residentNameOf, type FloorTaskApiRow } from "@/lib/floor/now-rows";
import { readFloorCache, writeFloorCache } from "@/lib/floor/memory-cache";
import { readFloorVocab, saveFloorVocab } from "@/lib/floor/vocab-store";
import { emptyObservationVocabCatalog, type ObservationVocabCatalog } from "@/lib/rounding/observation-chips";

import { useFloorSession } from "./FloorContext";
import { useFloorQuery } from "./useFloorQuery";

export type FloorCheckData = {
  task: FloorTaskApiRow;
  residentId: string;
  residentName: string;
  room: string | null;
  gender: string | null;
  /** Places, what they are doing, and the meal, mood and medication chips. */
  vocab: ObservationVocabCatalog;
  /** False when the census could not be read: the room is unknown, not missing. */
  roomKnown: boolean;
  /** True when the choices could not be read: say so, never "none set up". */
  vocabFailed: boolean;
};

const VOCAB_MAX_AGE_MS = 12 * 60 * 60_000;


/** The check, its resident (room, recorded gender for the questions) and the facility's check choices. */
export function useFloorCheckData(taskId: string) {
  const { supabase, facility } = useFloorSession();
  const facilityId = facility.facilityId;
  return useFloorQuery<FloorCheckData | null>(
    `check:${taskId}`,
    async () => {
      const vocabKey = `vocab:${facilityId}`;
      const [rows, vocab] = await Promise.all([
        // Offline, the queue Now already read this unlock still has the check.
        fetchFloorTasks({ facilityId, taskId }).catch((error: unknown) => {
          const cached = readFloorCache<FloorTaskApiRow[]>(`tasks:${facilityId}`, 12 * 60 * 60_000)?.filter((row) => row.id === taskId);
          if (cached && cached.length > 0) return cached;
          throw error;
        }),
        // Offline, the choices read earlier stand: this unlock's, else the ones kept on
        // the tablet from an earlier unlock (building configuration, no resident data).
        fetchFloorCheckVocab(supabase, facilityId)
          .then((catalog) => {
            writeFloorCache(vocabKey, catalog);
            void saveFloorVocab(facilityId, catalog);
            return catalog;
          })
          .catch(async (error: unknown) => {
            console.error("[floor] check choices", error);
            return readFloorCache<ObservationVocabCatalog>(vocabKey, VOCAB_MAX_AGE_MS) ?? (await readFloorVocab(facilityId));
          }),
      ]);
      const task = rows[0];
      const residentId = task?.residents?.id;
      if (!task || !residentId) return null;
      const censusKey = `census:${facilityId}`;
      let census = readFloorCache<Awaited<ReturnType<typeof fetchFloorCensus>>>(censusKey, 12 * 60 * 60_000);
      if (!census) {
        census = await fetchFloorCensus(supabase, facilityId).catch((error: unknown) => {
          console.error("[floor] census", error);
          return null;
        });
        if (census) writeFloorCache(censusKey, census);
      }
      // No recorded gender (or no network) keeps the questions neutral.
      const gender = await supabase
        .from("residents")
        .select("gender")
        .eq("id", residentId)
        .maybeSingle()
        .then(({ data }) => data?.gender ?? null, () => null);
      return {
        task,
        residentId,
        residentName: residentNameOf(task.residents),
        room: census?.find((row) => row.id === residentId)?.room ?? null,
        roomKnown: census !== null,
        vocabFailed: vocab === null,
        gender,
        vocab: vocab ?? emptyObservationVocabCatalog(),
      };
    },
    5_000,
  );
}
