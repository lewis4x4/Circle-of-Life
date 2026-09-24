/**
 * The floor app's query cache (spec 40 §5): page memory only, never
 * persisted, and emptied on every lock and unlock so the next person never
 * sees the previous person's reads, even for a frame.
 */

type Entry = { value: unknown; storedAt: number };

const entries = new Map<string, Entry>();

export function readFloorCache<T>(key: string, maxAgeMs: number, now: number = Date.now()): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.storedAt > maxAgeMs) {
    entries.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeFloorCache<T>(key: string, value: T, now: number = Date.now()): void {
  entries.set(key, { value, storedAt: now });
}

/** Drop every entry whose key starts with `prefix`, after a write changes what they show. */
export function dropFloorCache(prefix: string): void {
  for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
}

export function clearFloorCache(): void {
  entries.clear();
}

export function floorCacheSize(): number {
  return entries.size;
}
