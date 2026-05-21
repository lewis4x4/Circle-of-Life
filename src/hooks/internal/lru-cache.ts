/**
 * Tiny LRU helper for module-level fetch caches.
 *
 * JavaScript Maps preserve insertion order, so re-inserting on read keeps
 * the most-recently-used entries at the tail and the oldest at the head.
 * When the map is at capacity, the head entry is evicted.
 *
 * Designed for short-lived per-tab caches (a few KB to a few MB total),
 * not for cross-tab persistence — module state vanishes on hard reload.
 */
export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    // Move to "most recently used" by re-inserting.
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    // Drop the oldest (first inserted, hence least-recently used) entry.
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}
