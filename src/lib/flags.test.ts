import { describe, expect, it } from "vitest";
import { normalizeAdminRoute, resolveUiV2AdminRewritePath, uiV2 } from "./flags";

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
});
