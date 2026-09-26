/**
 * The facility's check choices (places, what the resident is doing, the meal,
 * mood and medication chips) kept on the tablet between unlocks, so the first
 * check after an unlock can be charted with no Wi-Fi (COL-861 follow-up).
 *
 * This is building configuration, the same for every resident and every
 * person, never anything read about a resident or typed by staff. That is why
 * it may outlive the page-memory query cache every lock empties
 * (`memory-cache.ts`, spec 40 §5). It lives in the floor's own IndexedDB store
 * beside the device token, never in localStorage.
 */

import { readFloorDeviceValue, writeFloorDeviceValue } from "@/lib/floor/device-store";
import type { ObservationVocabCatalog } from "@/lib/rounding/observation-chips";

const KEY_PREFIX = "check-choices:";

type Stored = { savedAt: string; catalog: ObservationVocabCatalog };

const FIELDS = ["location", "position", "state", "meal_intake", "mood_state", "med_response"] as const;

export function isFloorVocabCatalog(value: unknown): value is ObservationVocabCatalog {
  return Boolean(value) && typeof value === "object" && FIELDS.every((field) => Array.isArray((value as Record<string, unknown>)[field]));
}

export async function saveFloorVocab(facilityId: string, catalog: ObservationVocabCatalog, now: Date = new Date()): Promise<void> {
  await writeFloorDeviceValue<Stored>(KEY_PREFIX + facilityId, { savedAt: now.toISOString(), catalog });
}

export async function readFloorVocab(facilityId: string): Promise<ObservationVocabCatalog | null> {
  const stored = await readFloorDeviceValue<Stored>(KEY_PREFIX + facilityId);
  return stored && isFloorVocabCatalog(stored.catalog) ? stored.catalog : null;
}
