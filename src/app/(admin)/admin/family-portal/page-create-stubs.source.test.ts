import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const hubSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");
const conferenceNew = readFileSync(
  path.resolve(import.meta.dirname, "./conferences/new/page.tsx"),
  "utf8",
);
const consentNew = readFileSync(
  path.resolve(import.meta.dirname, "./consents/new/page.tsx"),
  "utf8",
);

describe("Family Connections create stubs", () => {
  it("does not offer Schedule conference or Add consent CTAs on the hub", () => {
    expect(hubSource).not.toContain("/admin/family-portal/conferences/new");
    expect(hubSource).not.toContain("/admin/family-portal/consents/new");
    expect(hubSource).not.toContain("+ Schedule conference");
    expect(hubSource).not.toContain("+ Add consent record");
  });

  it("sends leftover create URLs back to the hub instead of stub copy", () => {
    expect(conferenceNew).toContain('redirect("/admin/family-portal#care-conferences")');
    expect(conferenceNew).not.toContain("not wired in this segment");
    expect(consentNew).toContain('redirect("/admin/family-portal")');
    expect(consentNew).not.toContain("not wired in this segment");
  });
});
