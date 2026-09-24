import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_ALIAS_SEGMENTS, LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

// COL-707 (Brian, 2026-09-23): Family Connections is canonical; Family notes is its second view.
describe("family notes URLs", () => {
  it("308s every old family-messages URL to the Family notes view of Family Connections", () => {
    expect(ADMIN_ALIAS_SEGMENTS).not.toContain("family-messages");
    for (const source of ["/family-messages", "/admin/family-messages", "/admin/family-messages/:path*"]) {
      expect(LEGACY_REDIRECTS).toContainEqual({ source, destination: "/admin/family-portal?tab=notes", permanent: true });
    }
  });

  it("has no page of its own", () => {
    expect(existsSync(path.resolve(import.meta.dirname, "../app/(admin)/admin/family-messages/page.tsx"))).toBe(false);
  });
});
