import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CARE_PLAN_PRINT_NO_PLAN_TITLE } from "@/lib/care-plans/care-plan-print-copy";

const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`); }));
vi.mock("next/navigation", () => ({ redirect }));

const planRows = vi.hoisted(() => ({ data: [] as { id: string }[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      in: () => query,
      order: () => query,
      limit: async () => ({ data: planRows.data, error: null }),
    };
    return { from: () => query };
  },
}));

import LegacyCarePlanPrintRedirect from "./page";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";

describe("legacy care-plan print address", () => {
  beforeEach(() => {
    planRows.data = [];
  });

  it("sends a named plan to the shell-free sheet", async () => {
    await expect(
      LegacyCarePlanPrintRedirect({ params: Promise.resolve({ id: RESIDENT_ID }), searchParams: Promise.resolve({ plan: PLAN_ID }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /print/care-plans/${PLAN_ID}`);
  });

  it("prints the resident's current plan when the address names none", async () => {
    planRows.data = [{ id: PLAN_ID }];
    await expect(
      LegacyCarePlanPrintRedirect({ params: Promise.resolve({ id: RESIDENT_ID }), searchParams: Promise.resolve({ plan: "nope" }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /print/care-plans/${PLAN_ID}`);
  });

  it("says there is no plan instead of redirecting silently (COL-662)", async () => {
    const page = await LegacyCarePlanPrintRedirect({
      params: Promise.resolve({ id: RESIDENT_ID }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain(CARE_PLAN_PRINT_NO_PLAN_TITLE);
    expect(html).toContain(`/admin/residents/${RESIDENT_ID}/care-plan`);
    expect(redirect).not.toHaveBeenCalledWith(`/admin/residents/${RESIDENT_ID}/care-plan`);
  });
});
