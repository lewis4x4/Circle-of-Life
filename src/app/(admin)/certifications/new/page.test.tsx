import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewCertificationPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  user: { id: "user-1" } as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/certifications/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return query;
    },
  }),
}));

describe("AdminNewCertificationPage", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    mocks.user = { id: "user-1" };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults issue date to Eastern calendar today after 8pm ET, not the UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    render(<AdminNewCertificationPage />);

    const issueDateInput = screen.getByLabelText(/^issue date \(ET\)$/i);
    expect(issueDateInput).toHaveValue("2026-08-20");
    expect(issueDateInput).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses the shared facility date helper and labels both dates as Eastern", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Issue date (ET)");
    expect(pageSource).toContain("Expiration (optional, ET)");
    expect(pageSource).not.toMatch(/useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it("names the empty staff gap for the selected facility", async () => {
    render(<AdminNewCertificationPage />);

    expect(await screen.findByText("No active staff in this facility.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
  });
});
