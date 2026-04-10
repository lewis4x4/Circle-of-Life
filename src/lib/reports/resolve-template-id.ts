import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * `report_runs.source_id` is a UUID (FK-style reference). URL routes use template **slug**;
 * resolve to `report_templates.id` for inserts.
 */
export async function resolveReportTemplateIdBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
  organizationId: string,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("report_templates")
    .select("id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data?.id) {
    return { error: `Report template not found for slug "${slug}".` };
  }
  return { id: data.id };
}
