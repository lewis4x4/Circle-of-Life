import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

const hubSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("Family Connections create stubs", () => {
  it("does not offer Schedule conference or Add consent CTAs on the hub", () => {
    expect(hubSource).not.toContain("/admin/family-portal/conferences/new");
    expect(hubSource).not.toContain("/admin/family-portal/consents/new");
    expect(hubSource).not.toContain("+ Schedule conference");
    expect(hubSource).not.toContain("+ Add consent record");
  });

  it("sends leftover create URLs back to the hub with a server redirect, not a stub page (COL-707)", () => {
    for (const source of ["/admin/family-portal/conferences/new", "/admin/family-portal/consents/new"]) {
      expect(LEGACY_REDIRECTS.find((r) => r.source === source)?.destination).toBe("/admin/family-portal");
      expect(existsSync(path.resolve(import.meta.dirname, `.${source.replace("/admin/family-portal", "")}/page.tsx`))).toBe(false);
    }
  });
});
