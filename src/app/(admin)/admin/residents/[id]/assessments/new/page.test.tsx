import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AssessmentEntryPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const ANONYMOUS_RESIDENT_ID = "11111111-1111-1111-1111-111111111111";
const ANONYMOUS_ORG_ID = "22222222-2222-2222-2222-222222222222";
const ANONYMOUS_FACILITY_ID = "33333333-3333-3333-3333-333333333333";

const anonymousTemplate = {
  id: "44444444-4444-4444-4444-444444444444",
  assessment_type: "katz_adl",
  name: "Katz ADL Index",
  description: "Activities of daily living screen",
  score_range_min: 0,
  score_range_max: 6,
  risk_thresholds: { low: [0, 2], standard: [3, 4], high: [5, 6] },
  items: [
    {
      key: "bathing",
      label: "Bathing",
      options: [
        { value: 0, label: "Independent" },
        { value: 1, label: "Dependent" },
      ],
    },
  ],
  default_frequency_days: 90,
  required_role: ["owner"],
};

function makeSupabaseClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    maybeSingle: async () => ({
      data: {
        first_name: "Sample",
        last_name: "Resident",
        facility_id: ANONYMOUS_FACILITY_ID,
      },
      error: null,
    }),
    single: async () => ({ data: null, error: null }),
    insert: async () => ({ error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: [anonymousTemplate], error: null }).then(resolve),
  };

  return {
    from: (table: string) => {
      if (table === "residents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  first_name: "Sample",
                  last_name: "Resident",
                  facility_id: ANONYMOUS_FACILITY_ID,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "assessment_templates") {
        return chain;
      }
      return chain;
    },
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: ANONYMOUS_RESIDENT_ID }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: { id: "55555555-5555-5555-5555-555555555555" },
    organizationId: ANONYMOUS_ORG_ID,
    appRole: "owner",
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeSupabaseClient(),
}));

describe("AssessmentEntryPage assessment date", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults assessment date to Eastern calendar today at 8:05pm ET, not the UTC date", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<AssessmentEntryPage />);

      const templateButton = await screen.findByRole("button", { name: /Katz ADL Index/i });
      fireEvent.click(templateButton);

      const assessmentDateInput = await screen.findByLabelText(/^assessment date \(ET\)$/i);
      expect(assessmentDateInput).toHaveValue("2026-08-20");
      expect(assessmentDateInput).not.toHaveValue("2026-08-21");
      expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the shared facility date helper and stamps the assessment date as Eastern", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Assessment date (ET)");
    expect(pageSource).not.toMatch(
      /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
    expect(pageSource).toContain("computeNextDueDate");
  });
});
