import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewStaffPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  user: { id: "user-1" } as { id: string } | null,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/staff/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({}) }),
}));

describe("AdminNewStaffPage hire date defaults", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    mocks.user = { id: "user-1" };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults hire date to Eastern calendar today after 8pm ET, not UTC ISO slice", () => {
    /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    render(<AdminNewStaffPage />);

    const hireDateInput = screen.getByLabelText(/^hire date \(eastern time\)$/i);
    expect(hireDateInput).toHaveValue("2026-08-20");
    expect(hireDateInput).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("does not default hire date from a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Hire date (ET)");
    expect(pageSource).not.toMatch(/setHireDate[\s\S]*toISOString\(\)\.slice\(0,\s*10\)/);
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
