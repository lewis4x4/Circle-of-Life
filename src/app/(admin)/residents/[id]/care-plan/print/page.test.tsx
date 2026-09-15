import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`); }));
vi.mock("next/navigation", () => ({ redirect }));

import LegacyCarePlanPrintRedirect from "./page";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";

describe("legacy care-plan print address", () => {
  it("sends a named plan to the shell-free sheet", async () => {
    await expect(
      LegacyCarePlanPrintRedirect({ params: Promise.resolve({ id: RESIDENT_ID }), searchParams: Promise.resolve({ plan: PLAN_ID }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /print/care-plans/${PLAN_ID}`);
  });

  it("sends a missing or malformed plan back to the resident's care plan", async () => {
    await expect(
      LegacyCarePlanPrintRedirect({ params: Promise.resolve({ id: RESIDENT_ID }), searchParams: Promise.resolve({ plan: "nope" }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /admin/residents/${RESIDENT_ID}/care-plan`);
    await expect(
      LegacyCarePlanPrintRedirect({ params: Promise.resolve({ id: RESIDENT_ID }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(`NEXT_REDIRECT /admin/residents/${RESIDENT_ID}/care-plan`);
  });
});
