import { describe, expect, it } from "vitest";
import {
  UI_V2_IMPLEMENTED_ROUTES,
  normalizeAdminRoute,
  resolveUiV2AdminRewritePath,
  uiV2,
} from "./flags";

describe("UI-V2 flags", () => {
  it("defaults off unless NEXT_PUBLIC_UI_V2 is true", () => {
    expect(uiV2({})).toBe(false);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "false" })).toBe(false);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "true" })).toBe(true);
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

  it("non-W1 admin routes still fall through (V1) even with the flag on", () => {
    expect(
      resolveUiV2AdminRewritePath("/admin/residents", { enabled: true }),
    ).toBeNull();
    expect(
      resolveUiV2AdminRewritePath("/admin/billing", { enabled: true }),
    ).toBeNull();
  });
});
