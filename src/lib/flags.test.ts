import { describe, expect, it } from "vitest";
import {
  UI_V2_IMPLEMENTED_PREFIXES,
  UI_V2_IMPLEMENTED_ROUTES,
  normalizeAdminRoute,
  resolveUiV2AdminRewritePath,
  uiV2,
} from "./flags";

describe("UI-V2 flags", () => {
  it("defaults ON; only `NEXT_PUBLIC_UI_V2=false` flips to V1 (kill-switch)", () => {
    // After S12 production cutover, V2 is the canonical shell. The flag is
    // retained as a kill-switch only — the only env value that reverts to V1.
    expect(uiV2({})).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "true" })).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "anything-else" })).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "false" })).toBe(false);
  });

  it("normalizes public admin paths to internal route keys", () => {
    expect(normalizeAdminRoute("/admin")).toBe("/");
    expect(normalizeAdminRoute("/admin/executive")).toBe("/executive");
    expect(normalizeAdminRoute("/admin/executive/alerts")).toBe("/executive/alerts");
    expect(normalizeAdminRoute("/admin/v2/executive")).toBeNull();
    expect(normalizeAdminRoute("/caregiver")).toBeNull();
  });

  it("rewrites only when flag is on and a V2 route implementation exists", () => {
    const implementedRoutes = new Set(["/", "/executive"]);

    expect(
      resolveUiV2AdminRewritePath("/admin/executive", {
        enabled: true,
        implementedRoutes,
      }),
    ).toBe("/admin/v2/executive");

    expect(
      resolveUiV2AdminRewritePath("/admin/quality", {
        enabled: true,
        implementedRoutes,
      }),
    ).toBeNull();

    expect(
      resolveUiV2AdminRewritePath("/admin/executive", {
        enabled: false,
        implementedRoutes,
      }),
    ).toBeNull();
  });

  it("S8 W1 routes are registered as implemented", () => {
    // Adding a route here without shipping the page is a 404 trap; this test
    // tracks the four W1 P0 dashboards landed in S8.
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/executive")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/quality")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/rounding")).toBe(true);
  });

  it("rewrites every S8 W1 route via the live registry", () => {
    expect(
      resolveUiV2AdminRewritePath("/admin", { enabled: true }),
    ).toBe("/admin/v2");
    expect(
      resolveUiV2AdminRewritePath("/admin/executive", { enabled: true }),
    ).toBe("/admin/v2/executive");
    expect(
      resolveUiV2AdminRewritePath("/admin/quality", { enabled: true }),
    ).toBe("/admin/v2/quality");
    expect(
      resolveUiV2AdminRewritePath("/admin/rounding", { enabled: true }),
    ).toBe("/admin/v2/rounding");
  });

  it("non-W1/W2 admin routes still fall through (V1) even with the flag on", () => {
    expect(
      resolveUiV2AdminRewritePath("/admin/billing", { enabled: true }),
    ).toBeNull();
    expect(
      resolveUiV2AdminRewritePath("/admin/care-plans/reviews-due", { enabled: true }),
    ).toBeNull();
  });

  it("S9 W2 prefixes are registered for the four list+detail pairs", () => {
    expect(UI_V2_IMPLEMENTED_PREFIXES.has("/residents")).toBe(true);
    expect(UI_V2_IMPLEMENTED_PREFIXES.has("/incidents")).toBe(true);
    expect(UI_V2_IMPLEMENTED_PREFIXES.has("/admissions")).toBe(true);
    expect(UI_V2_IMPLEMENTED_PREFIXES.has("/executive/alerts")).toBe(true);
  });

  it("rewrites the W2 list root and any subtree path under each prefix", () => {
    // List roots
    expect(
      resolveUiV2AdminRewritePath("/admin/residents", { enabled: true }),
    ).toBe("/admin/v2/residents");
    expect(
      resolveUiV2AdminRewritePath("/admin/incidents", { enabled: true }),
    ).toBe("/admin/v2/incidents");
    expect(
      resolveUiV2AdminRewritePath("/admin/admissions", { enabled: true }),
    ).toBe("/admin/v2/admissions");
    expect(
      resolveUiV2AdminRewritePath("/admin/executive/alerts", { enabled: true }),
    ).toBe("/admin/v2/executive/alerts");

    // Detail subtree
    expect(
      resolveUiV2AdminRewritePath("/admin/residents/abc-123", { enabled: true }),
    ).toBe("/admin/v2/residents/abc-123");
    expect(
      resolveUiV2AdminRewritePath("/admin/incidents/inc-1", { enabled: true }),
    ).toBe("/admin/v2/incidents/inc-1");
    expect(
      resolveUiV2AdminRewritePath("/admin/executive/alerts/al-99", { enabled: true }),
    ).toBe("/admin/v2/executive/alerts/al-99");
  });

  it("does NOT rewrite resident sub-routes that S9 left on V1", () => {
    // /admin/residents/[id] is rewritten (one segment deep). Deeper paths like
    // /admin/residents/[id]/care-plan fall through to V1 because S9 only
    // shipped detail roots; sub-routes get explicit V2 in S10/S11.
    expect(
      resolveUiV2AdminRewritePath("/admin/residents/abc-123/care-plan", {
        enabled: true,
      }),
    ).toBeNull();
    expect(
      resolveUiV2AdminRewritePath("/admin/residents/abc-123/medications", {
        enabled: true,
      }),
    ).toBeNull();
  });

  it("S10 W3 analytics + W4 finance routes are registered", () => {
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/executive/standup")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/executive/reports")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/executive/benchmarks")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/finance")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/finance/ledger")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/finance/trial-balance")).toBe(true);
    expect(UI_V2_IMPLEMENTED_PREFIXES.has("/executive/facility")).toBe(true);
  });

  it("rewrites every S10 W3 analytics + W4 finance route", () => {
    expect(resolveUiV2AdminRewritePath("/admin/executive/standup", { enabled: true })).toBe(
      "/admin/v2/executive/standup",
    );
    expect(resolveUiV2AdminRewritePath("/admin/executive/reports", { enabled: true })).toBe(
      "/admin/v2/executive/reports",
    );
    expect(
      resolveUiV2AdminRewritePath("/admin/executive/benchmarks", { enabled: true }),
    ).toBe("/admin/v2/executive/benchmarks");
    expect(
      resolveUiV2AdminRewritePath("/admin/executive/facility/abc-123", { enabled: true }),
    ).toBe("/admin/v2/executive/facility/abc-123");
    expect(resolveUiV2AdminRewritePath("/admin/finance", { enabled: true })).toBe(
      "/admin/v2/finance",
    );
    expect(resolveUiV2AdminRewritePath("/admin/finance/ledger", { enabled: true })).toBe(
      "/admin/v2/finance/ledger",
    );
    expect(
      resolveUiV2AdminRewritePath("/admin/finance/trial-balance", { enabled: true }),
    ).toBe("/admin/v2/finance/trial-balance");
  });

  it("S10 form routes are covered by S9 list prefixes (one-deep rewrite)", () => {
    // /admin/residents/new gets rewritten via the /residents prefix because
    // it's one segment deep — the V2 page at residents/new/page.tsx wins over
    // [id]/page.tsx via Next routing precedence (static beats dynamic).
    expect(resolveUiV2AdminRewritePath("/admin/residents/new", { enabled: true })).toBe(
      "/admin/v2/residents/new",
    );
    expect(resolveUiV2AdminRewritePath("/admin/incidents/new", { enabled: true })).toBe(
      "/admin/v2/incidents/new",
    );
    expect(resolveUiV2AdminRewritePath("/admin/admissions/new", { enabled: true })).toBe(
      "/admin/v2/admissions/new",
    );
  });

  it("S11 W5 settings routes are registered as exact matches", () => {
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/settings/thresholds")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/settings/audit-log")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/settings/users")).toBe(true);
    expect(UI_V2_IMPLEMENTED_ROUTES.has("/settings/notifications")).toBe(true);
  });

  it("rewrites every S11 settings route", () => {
    expect(
      resolveUiV2AdminRewritePath("/admin/settings/thresholds", { enabled: true }),
    ).toBe("/admin/v2/settings/thresholds");
    expect(
      resolveUiV2AdminRewritePath("/admin/settings/audit-log", { enabled: true }),
    ).toBe("/admin/v2/settings/audit-log");
    expect(
      resolveUiV2AdminRewritePath("/admin/settings/users", { enabled: true }),
    ).toBe("/admin/v2/settings/users");
    expect(
      resolveUiV2AdminRewritePath("/admin/settings/notifications", { enabled: true }),
    ).toBe("/admin/v2/settings/notifications");
  });

  it("does NOT rewrite settings paths the V2 build hasn't shipped", () => {
    // /admin/settings (root) and any setting that isn't in the registry should
    // continue to fall through to the V1 page so we don't strand visitors on
    // empty V2 placeholders.
    expect(
      resolveUiV2AdminRewritePath("/admin/settings", { enabled: true }),
    ).toBeNull();
    expect(
      resolveUiV2AdminRewritePath("/admin/settings/integrations", { enabled: true }),
    ).toBeNull();
  });
});
