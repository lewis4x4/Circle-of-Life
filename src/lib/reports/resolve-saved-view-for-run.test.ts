import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { resolveSavedViewForRun } from "./resolve-saved-view-for-run";

const VIEW_ID = "a1b2c3d4-e5f6-4a70-8b9c-0d1e2f3a4b5c";
const TEMPLATE_ID = "b2c3d4e5-f6a7-4b81-9c0d-1e2f3a4b5c6d";
const VERSION_ID = "c3d4e5f6-a7b8-4c92-ad1e-2f3a4b5c6d7e";

type Queue = Record<string, ReturnType<typeof vi.fn>>;

function makeClient(handlers: {
  view?: { data: unknown; error: unknown };
  template?: { data: unknown; error: unknown };
}) {
  const from = vi.fn((table: string) => {
    const q: Queue = {};
    for (const n of ["select", "eq", "is", "or", "limit"]) {
      q[n] = vi.fn(() => q);
    }
    q.maybeSingle = vi.fn(async () => {
      if (table === "report_saved_views") {
        return handlers.view ?? { data: null, error: null };
      }
      if (table === "report_templates") {
        return handlers.template ?? { data: null, error: null };
      }
      return { data: null, error: null };
    });
    return q;
  });
  return { from } as unknown as SupabaseClient<Database>;
}

it("denies invalid UUID (does not treat garbage as template slug)", async () => {
  const supabase = makeClient({});
  const result = await resolveSavedViewForRun(supabase, {
    organizationId: "org",
    viewId: "not-a-uuid",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.denial).toBe("invalid_id");
  }
});

it("denies missing view / wrong org without leaking", async () => {
  const supabase = makeClient({ view: { data: null, error: null } });
  const result = await resolveSavedViewForRun(supabase, {
    organizationId: "org",
    viewId: VIEW_ID,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.denial).toBe("not_found");
    expect(result.error).toMatch(/not found/i);
  }
});

it("denies archived saved views", async () => {
  const supabase = makeClient({
    view: {
      data: {
        id: VIEW_ID,
        name: "Archived variant",
        template_id: TEMPLATE_ID,
        template_version_id: VERSION_ID,
        pinned_template_version: true,
        archived_at: "2026-09-01T00:00:00Z",
        organization_id: "org",
      },
      error: null,
    },
  });
  const result = await resolveSavedViewForRun(supabase, {
    organizationId: "org",
    viewId: VIEW_ID,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.denial).toBe("archived");
  }
});

it("denies when linked template is missing", async () => {
  const supabase = makeClient({
    view: {
      data: {
        id: VIEW_ID,
        name: "Variant",
        template_id: TEMPLATE_ID,
        template_version_id: VERSION_ID,
        pinned_template_version: true,
        archived_at: null,
        organization_id: "org",
      },
      error: null,
    },
    template: { data: null, error: null },
  });
  const result = await resolveSavedViewForRun(supabase, {
    organizationId: "org",
    viewId: VIEW_ID,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.denial).toBe("template_missing");
  }
});

it("resolves slug from saved view (corrected path — UUID is not the slug)", async () => {
  const supabase = makeClient({
    view: {
      data: {
        id: VIEW_ID,
        name: "My census cut",
        template_id: TEMPLATE_ID,
        template_version_id: VERSION_ID,
        pinned_template_version: true,
        archived_at: null,
        organization_id: "org",
      },
      error: null,
    },
    template: {
      data: { id: TEMPLATE_ID, slug: "census", name: "Census" },
      error: null,
    },
  });
  const result = await resolveSavedViewForRun(supabase, {
    organizationId: "org",
    viewId: VIEW_ID,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.slug).toBe("census");
    expect(result.slug).not.toBe(VIEW_ID);
    expect(result.title).toBe("My census cut");
    expect(result.templateId).toBe(TEMPLATE_ID);
    expect(result.templateVersionId).toBe(VERSION_ID);
    expect(result.viewId).toBe(VIEW_ID);
  }
});
