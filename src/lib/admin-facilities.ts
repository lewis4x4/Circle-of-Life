import { createClient } from "@/lib/supabase/client";

type QueryError = { message: string };
type FacilityRow = { id: string; name: string };

/**
 * Facilities visible to the current user under RLS (typically org/facility-scoped admin).
 */
export async function fetchAdminFacilityOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const result = (await supabase
    .from("facilities" as never)
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true })) as { data: FacilityRow[] | null; error: QueryError | null };

  if (result.error) {
    throw result.error;
  }

  const rows = result.data ?? [];
  return rows.map((row) => ({ id: row.id, name: row.name?.trim() || "Unnamed facility" }));
}
