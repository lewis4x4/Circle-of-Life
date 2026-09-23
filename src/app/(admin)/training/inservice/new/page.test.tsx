import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminNewInserviceSessionPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");
const mocks = vi.hoisted(() => {
  // Every query builder call chains; awaiting it yields an empty result.
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
          : () => chain,
    },
  );
  return {
    client: { from: vi.fn(() => chain) },
    store: {
      selectedFacilityId: "11111111-1111-4111-8111-111111111111" as string | null,
      availableFacilities: [{ id: "11111111-1111-4111-8111-111111111111", name: "Homewood Lodge" }],
      facilitiesCacheUserId: "anonymous-operator",
      setSelectedFacility: vi.fn(() => true),
      setAvailableFacilities: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/training/inservice/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (selector?: (state: typeof mocks.store) => unknown) =>
    selector ? selector(mocks.store) : mocks.store,
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "anonymous-operator" } }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));

describe("AdminNewInserviceSessionPage session date", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.store.selectedFacilityId = "11111111-1111-4111-8111-111111111111";
  });

  it("under All facilities shows the facility gate instead of an unsubmittable form (COL-651)", () => {
    mocks.store.selectedFacilityId = null;
    mocks.store.availableFacilities.push({ id: "22222222-2222-4222-8222-222222222222", name: "Oakridge ALF" });

    render(<AdminNewInserviceSessionPage />);

    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^session date \(ET\)$/i)).not.toBeInTheDocument();
    mocks.store.availableFacilities.pop();
  });

  it("defaults to the Eastern calendar date at 8:05pm ET, not the next UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    render(<AdminNewInserviceSessionPage />);

    const sessionDateInput = screen.getByLabelText(/^session date \(ET\)$/i);
    expect(sessionDateInput).toHaveValue("2026-08-20");
    expect(sessionDateInput).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses the shared facility date helper independent of save implementation", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Session date (ET)");
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
