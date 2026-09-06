import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
type CountInsert = Database["public"]["Tables"]["controlled_substance_counts"]["Insert"] & { id: string };
export type SavedControlledCount = Pick<Database["public"]["Tables"]["controlled_substance_counts"]["Row"], "id" | "resident_medication_id" | "expected_count" | "actual_count" | "count_date" | "shift">;
export const COUNT_RECEIPT_COLUMNS = "id,resident_medication_id,expected_count,actual_count,count_date,shift";
/** One statement saves the whole count batch. Exact retries return its persisted receipt. */
export async function saveControlledCountBatch(client: SupabaseClient<Database>, rows: CountInsert[]): Promise<SavedControlledCount[]> {
  if (!rows.length) throw new Error("There are no counts to record.");
  const inserted = await client.from("controlled_substance_counts").insert(rows).select(COUNT_RECEIPT_COLUMNS);
  if (!inserted.error) return inserted.data ?? [];
  if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
  const existing = await client.from("controlled_substance_counts").select(COUNT_RECEIPT_COLUMNS).in("id", rows.map((row) => row.id)).is("deleted_at", null);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length !== rows.length || rows.some((row) => !existing.data.some((saved) => saved.id === row.id && saved.resident_medication_id === row.resident_medication_id && saved.expected_count === row.expected_count && saved.actual_count === row.actual_count && saved.count_date === row.count_date && saved.shift === row.shift))) {
    throw new Error("This count attempt was already saved with different values. Reload the pending counts before continuing.");
  }
  return existing.data;
}
