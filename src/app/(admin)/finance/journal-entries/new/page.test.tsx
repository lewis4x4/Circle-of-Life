import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NewJournalEntryPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");
const mocks = vi.hoisted(() => ({
  client: { from: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/finance/journal-entries/new",
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: "00000000-0000-4000-8000-00000000org1",
    appRole: "org_admin",
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../../finance-hub-nav", () => ({ FinanceHubNav: () => null }));

describe("NewJournalEntryPage entry date", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults to the Eastern calendar date at 8:05pm ET, not the next UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    mocks.client.from.mockReturnValue(builder);

    render(<NewJournalEntryPage />);

    const entryDateInput = screen.getByLabelText(/^entry date \(ET\)$/i);
    expect(entryDateInput).toHaveValue("2026-08-20");
    expect(entryDateInput).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses the shared facility date helper instead of a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Entry date (ET)");
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
