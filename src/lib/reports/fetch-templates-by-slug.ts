import { createClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

/** Active templates visible to org (tenant-specific + system-wide `organization_id` null). */
export async function fetchActiveTemplatesBySlug(
  supabase: SupabaseBrowserClient,
  organizationId: string,
  slugs: string[],
): Promise<{ id: string; slug: string }[]> {
  if (slugs.length === 0) return [];
  const { data, error } = await supabase
    .from("report_templates")
    .select("id, slug")
    .in("slug", slugs)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`organization_id.eq.${organizationId},organization_id.is.null`);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; slug: string }[];
}

/** Preserve caller slug order (drops unknown slugs). */
export function orderTemplateIdsBySlugOrder(
  rows: { id: string; slug: string }[],
  slugOrder: string[],
): string[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const out: string[] = [];
  for (const slug of slugOrder) {
    const id = bySlug.get(slug);
    if (id) out.push(id);
  }
  return out;
}
