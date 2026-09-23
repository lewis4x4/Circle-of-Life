import { describe, expect, it } from "vitest";

import { ADMIN_ALIAS_SEGMENTS, LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

describe("family-messages short URL", () => {
  it("redirects /family-messages to the admin hub like other mirrored segments", () => {
    expect(ADMIN_ALIAS_SEGMENTS).toContain("family-messages");
    expect(LEGACY_REDIRECTS).toContainEqual({
      source: "/family-messages",
      destination: "/admin/family-messages",
      permanent: true,
    });
  });
});
