/**
 * COL-333 guard: an intake from a referral is one server transaction
 * (POST /api/admin/workflows/admission-intake, migration 537). The admission
 * form must not write the inquiry resident itself, invent a gender, or send a
 * referral to the legacy case route; no screen may set move_in directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

describe("referral intake and move-in stay server-side (COL-333)", () => {
  const page = read("src/app/(admin)/admin/admissions/new/page.tsx");

  it("the referral path posts to the intake transaction", () => {
    expect(page).toContain("/api/admin/workflows/admission-intake");
  });

  it("the form invents no gender and sends no referral to the legacy case route", () => {
    expect(page).not.toMatch(/gender:\s*"prefer_not_to_say"/);
    expect(page).not.toMatch(/referral_lead_id:\s*payloadLeadId/);
  });

  it.each([
    "src/app/(admin)/admin/admissions/[id]/page.tsx",
    "src/app/(admin)/admin/admissions/move-in-ready/page.tsx",
  ])("%s never sets move_in itself", (file) => {
    expect(read(file)).not.toMatch(/status:\s*"move_in"/);
  });
});
