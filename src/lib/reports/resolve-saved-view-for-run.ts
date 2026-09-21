import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export const REPORT_RUN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SavedViewRunDenial =
  | "invalid_id"
  | "not_found"
  | "archived"
  | "template_missing";

export type ResolveSavedViewForRunResult =
  | {
      ok: true;
      viewId: string;
      name: string;
      templateId: string;
      templateVersionId: string;
      pinnedTemplateVersion: boolean;
      slug: string;
      title: string;
    }
  | {
      ok: false;
      error: string;
      denial: SavedViewRunDenial;
    };

/**
 * Resolve a saved report variant for the run route.
 * Org-scoped, excludes soft-deleted and archived views.
 * Does not treat the view UUID as a template slug (COL-296 / NAV-004).
 */
export async function resolveSavedViewForRun(
  supabase: SupabaseClient<Database>,
  params: { organizationId: string; viewId: string },
): Promise<ResolveSavedViewForRunResult> {
  const { organizationId, viewId } = params;

  if (!REPORT_RUN_UUID_RE.test(viewId)) {
    return {
      ok: false,
      error: "Invalid saved report reference.",
      denial: "invalid_id",
    };
  }

  const { data: view, error: viewErr } = await supabase
    .from("report_saved_views")
    .select(
      "id, name, template_id, template_version_id, pinned_template_version, archived_at, organization_id",
    )
    .eq("id", viewId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (viewErr) {
    return { ok: false, error: viewErr.message, denial: "not_found" };
  }
  if (!view) {
    return {
      ok: false,
      error: "Saved report not found.",
      denial: "not_found",
    };
  }
  if (view.archived_at) {
    return {
      ok: false,
      error: "This saved report has been archived and cannot be run.",
      denial: "archived",
    };
  }

  const { data: template, error: tplErr } = await supabase
    .from("report_templates")
    .select("id, slug, name")
    .eq("id", view.template_id)
    .is("deleted_at", null)
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .maybeSingle();

  if (tplErr) {
    return { ok: false, error: tplErr.message, denial: "template_missing" };
  }
  if (!template?.slug) {
    return {
      ok: false,
      error: "Template for this saved report is missing or unavailable.",
      denial: "template_missing",
    };
  }

  const viewName = typeof view.name === "string" ? view.name.trim() : "";
  const templateName = typeof template.name === "string" ? template.name : template.slug;

  return {
    ok: true,
    viewId: view.id,
    name: viewName || templateName,
    templateId: template.id,
    templateVersionId: view.template_version_id,
    pinnedTemplateVersion: Boolean(view.pinned_template_version),
    slug: template.slug,
    title: viewName || templateName,
  };
}
