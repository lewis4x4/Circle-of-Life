import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANCHOR_ONLY_ROUTES,
  AUXILIARY_ROUTES,
  PILLARS,
  PILLAR_ITEM_CAP,
  resolveNavAnchor,
} from "./pillars";
import { routeIsWithin } from "./route-match";

const ADMIN_APP_DIR = path.join(process.cwd(), "src/app/(admin)/admin");

/** Every `/admin/...` page the app serves, dynamic segments filled with a sample value. */
function adminPageRoutes(dir = ADMIN_APP_DIR, prefix = "/admin"): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.replace(/^\[+\.*([^\]]+)\]+$/, "sample-$1");
      routes.push(...adminPageRoutes(full, `${prefix}/${segment}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix);
    }
  }
  return routes;
}

describe("navigation anchoring (COL-655)", () => {
  const routes = adminPageRoutes();

  it("finds the admin page tree", () => {
    expect(routes.length).toBeGreaterThan(250);
  });

  it.each(routes)("%s is owned by a pillar item or an explicitly listed ⌘K / anchor-only route", (route) => {
    const anchor = resolveNavAnchor(route);
    expect(anchor, `${route} has no nav anchor — add it to a pillar item's tree, AUXILIARY_ROUTES, or ANCHOR_ONLY_ROUTES`).not.toBeNull();
  });

  it("does not let the Home item swallow every admin page into Command", () => {
    for (const route of ["/admin/acknowledgments", "/admin/meetings", "/admin/teams", "/admin/forms"]) {
      expect(resolveNavAnchor(route)?.pillarId, route).toBe("workforce");
    }
    expect(resolveNavAnchor("/admin/activities")?.pillarId).toBe("clinical");
    expect(resolveNavAnchor("/admin/nurse-dashboard")?.pillarId).toBe("clinical");
    expect(resolveNavAnchor("/admin/family-portal/consents/new")?.pillarId).toBe("pipeline");
    expect(resolveNavAnchor("/admin/survey-binder")?.pillarId).toBe("quality");
    expect(resolveNavAnchor("/admin/settings/users")?.pillarId).toBeNull();
    expect(resolveNavAnchor("/admin/v2/settings/users")?.pillarId).toBeNull();
    expect(resolveNavAnchor("/admin")?.item.key).toBe("owner-home");
  });

  it("anchors Finance, Insurance, Cash and Letters to their own Business items across their trees", () => {
    expect(resolveNavAnchor("/admin/finance/journal-entries/sample-id")?.item.key).toBe("finance");
    expect(resolveNavAnchor("/admin/insurance/coi")?.item.key).toBe("insurance");
    expect(resolveNavAnchor("/admin/cash")?.item.key).toBe("cash");
    expect(resolveNavAnchor("/admin/letters/generate")?.item.key).toBe("letters");
    for (const key of ["finance", "insurance", "cash", "letters"]) {
      expect(PILLARS.find((pillar) => pillar.id === "finance")?.items.map((item) => item.key)).toContain(key);
    }
  });

  it("lights the most specific owner", () => {
    expect(resolveNavAnchor("/admin/medications/errors/new")?.item.key).toBe("medication-errors");
    expect(resolveNavAnchor("/admin/medications/controlled")?.item.key).toBe("medications");
    expect(resolveNavAnchor("/admin/knowledge/documents/sample-id")?.item.key).toBe("kb-admin");
    expect(resolveNavAnchor("/admin/knowledge")?.item.key).toBe("kb-chat");
    expect(resolveNavAnchor("/admin/executive/cfo")?.item.key).toBe("executive");
    expect(resolveNavAnchor("/admin/executive/standup/history")?.item.key).toBe("stand-up");
    expect(resolveNavAnchor("/admin/rounding/live")?.item.key).toBe("rounding");
    expect(resolveNavAnchor("/admin/billing/collections")?.item.key).toBe("billing");
    expect(resolveNavAnchor("/admin/operations/attention")?.item.key).toBe("operations");
    expect(resolveNavAnchor("/admin/care-plans/sample-id")?.item.key).toBe("care-plans");
  });

  it("keeps Transportation out of Clinical and off the Vendors icon", () => {
    const transportation = PILLARS.flatMap((pillar) => pillar.items.map((item) => ({ pillar, item })))
      .find(({ item }) => item.key === "transportation");
    const vendors = PILLARS.flatMap((pillar) => pillar.items).find((item) => item.key === "vendors");
    expect(transportation?.pillar.id).not.toBe("clinical");
    expect(transportation?.item.icon).not.toBe(vendors?.icon);
  });

  it("keeps every pillar within the item cap", () => {
    for (const pillar of PILLARS) expect(pillar.items.length, pillar.id).toBeLessThanOrEqual(PILLAR_ITEM_CAP);
  });

  it("gives every catalog entry a unique key and destination", () => {
    const entries = [...PILLARS.flatMap((pillar) => pillar.items), ...AUXILIARY_ROUTES, ...ANCHOR_ONLY_ROUTES];
    const keys = entries.map((entry) => entry.key);
    const hrefs = entries.map((entry) => entry.href);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("routeIsWithin", () => {
  it("matches whole path segments only", () => {
    expect(routeIsWithin("/caregiver/meds", "/caregiver/me")).toBe(false);
    expect(routeIsWithin("/caregiver/me", "/caregiver/me")).toBe(true);
    expect(routeIsWithin("/caregiver/me/profile", "/caregiver/me")).toBe(true);
    expect(routeIsWithin("/admin/dietary", "/admin/dietary#snack-pass")).toBe(true);
  });
});
