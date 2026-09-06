import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminNewInserviceSessionPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");
const mocks = vi.hoisted(() => ({
  client: { from: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/training/inservice/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
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
