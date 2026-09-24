import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AssessmentEntryPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const ANONYMOUS_RESIDENT_ID = "11111111-1111-1111-1111-111111111111";
const ANONYMOUS_ORG_ID = "22222222-2222-2222-2222-222222222222";
const ANONYMOUS_FACILITY_ID = "33333333-3333-3333-3333-333333333333";
const ANONYMOUS_USER_ID = "55555555-5555-5555-5555-555555555555";

const katzTemplate = {
  id: "44444444-4444-4444-4444-444444444444",
  assessment_type: "katz_adl",
  name: "Katz ADL Index",
  description: "Activities of daily living screen",
  score_range_min: 0,
  score_range_max: 2,
  risk_thresholds: { level_1: [0, 0], level_2: [1, 1], level_3: [2, 2] },
  items: [
    {
      key: "bathing",
      label: "Bathing",
      options: [
        { value: 0, label: "Independent" },
        { value: 1, label: "Dependent" },
      ],
    },
    {
      key: "dressing",
      label: "Dressing",
      options: [
        { value: 0, label: "Independent" },
        { value: 1, label: "Dependent" },
      ],
    },
  ],
  default_frequency_days: 90,
  required_role: ["owner"],
};

const bradenTemplate = {
  id: "66666666-6666-6666-6666-666666666666",
  assessment_type: "braden",
  name: "Braden Scale for Predicting Pressure Sore Risk",
  description: "Assesses risk for pressure injuries across 6 subscales",
  score_range_min: 2,
  score_range_max: 8,
  risk_thresholds: { very_high: [2, 3], high: [4, 5], none: [6, 8] },
  items: [
    {
      key: "sensory_perception",
      label: "Sensory Perception",
      options: [
        { value: 1, label: "Completely Limited" },
        { value: 2, label: "Very Limited" },
        { value: 3, label: "Slightly Limited" },
        { value: 4, label: "No Impairment" },
      ],
    },
    {
      key: "moisture",
      label: "Moisture",
      options: [
        { value: 1, label: "Constantly Moist" },
        { value: 2, label: "Very Moist" },
        { value: 3, label: "Occasionally Moist" },
        { value: 4, label: "Rarely Moist" },
      ],
    },
  ],
  default_frequency_days: 90,
  required_role: ["owner"],
};

type Op = { method: string; args: unknown[] };

type Harness = {
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  failInsertWith: string | null;
  sameDayCount: number;
  includeHeldPhq9: boolean;
};

const phq9HeldTemplate = {
  id: "88888888-8888-8888-8888-888888888888",
  assessment_type: "phq9",
  name: "PHQ-9",
  description: "Depression screening tool",
  score_range_min: 0,
  score_range_max: 3,
  risk_thresholds: { minimal: [0, 1], severe: [2, 3] },
  items: [
    {
      key: "interest",
      label: "Little interest or pleasure in doing things",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
      ],
    },
  ],
  default_frequency_days: 180,
  required_role: ["owner"],
  held_reason: "PHQ-9 cannot be recorded in Haven yet.",
};

const harness: Harness = {
  inserts: [],
  updates: [],
  failInsertWith: null,
  sameDayCount: 0,
  includeHeldPhq9: false,
};

function resolveQuery(table: string, ops: Op[]) {
  const has = (m: string) => ops.some((o) => o.method === m);
  const selectOp = ops.find((o) => o.method === "select");
  if (table === "residents" && has("select") && !has("update")) {
    return {
      data: { first_name: "Sample", last_name: "Resident", facility_id: ANONYMOUS_FACILITY_ID },
      error: null,
    };
  }
  if (table === "residents" && has("update")) {
    return { data: { id: ANONYMOUS_RESIDENT_ID }, error: null };
  }
  if (table === "assessment_templates") {
    return {
      data: harness.includeHeldPhq9
        ? [katzTemplate, bradenTemplate, phq9HeldTemplate]
        : [katzTemplate, bradenTemplate],
      error: null,
    };
  }
  if (table === "assessments" && has("insert")) {
    const payload = ops.find((o) => o.method === "insert")?.args[0];
    if (harness.failInsertWith) return { data: null, error: { message: harness.failInsertWith } };
    harness.inserts.push({ table, payload });
    return { data: { id: "77777777-7777-7777-7777-777777777777" }, error: null };
  }
  if (table === "assessments" && selectOp && (selectOp.args[1] as { head?: boolean } | undefined)?.head) {
    return { data: null, error: null, count: harness.sameDayCount };
  }
  if (table === "assessments") {
    return { data: [], error: null };
  }
  if (table === "care_plans") return { data: null, error: null };
  return { data: null, error: null };
}

function makeSupabaseClient() {
  return {
    from: (table: string) => {
      const ops: Op[] = [];
      const builder: Record<string, unknown> = {};
      const chain = (method: string) =>
        (...args: unknown[]) => {
          ops.push({ method, args });
          if (method === "update") harness.updates.push({ table, payload: args[0] });
          return builder;
        };
      for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "update"]) {
        builder[m] = chain(m);
      }
      builder.maybeSingle = async () => resolveQuery(table, ops);
      builder.single = async () => resolveQuery(table, ops);
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table, ops)).then(resolve, reject);
      return builder;
    },
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: ANONYMOUS_RESIDENT_ID }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: { id: ANONYMOUS_USER_ID },
    organizationId: ANONYMOUS_ORG_ID,
    appRole: "owner",
    fullName: "Sample Nurse",
    email: "sample.nurse@example.test",
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeSupabaseClient(),
}));

async function pickInstrument(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  fireEvent.click(button);
}

function answer(section: string, option: string) {
  const group = screen.getByRole("group", { name: new RegExp(section, "i") });
  fireEvent.click(within(group).getByRole("radio", { name: new RegExp(`^${option}\\b`, "i") }));
}

beforeEach(() => {
  harness.inserts = [];
  harness.updates = [];
  harness.failInsertWith = null;
  harness.sameDayCount = 0;
  harness.includeHeldPhq9 = false;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AssessmentEntryPage assessment date", () => {
  it("defaults assessment date to Eastern calendar today at 8:05pm ET, not the UTC date", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<AssessmentEntryPage />);
      await pickInstrument(/Katz ADL Index/i);

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
    expect(pageSource).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

describe("AssessmentEntryPage instrument picker", () => {
  it("labels each interval as a Haven default and shows the score range", async () => {
    render(<AssessmentEntryPage />);
    const katz = await screen.findByRole("button", { name: /Katz ADL Index/i });
    expect(katz).toHaveTextContent("Score range 0–2");
    expect(katz).toHaveTextContent("Every 90 days (standard schedule)");
    expect(screen.getByText(/not facility-configured schedules/i)).toBeInTheDocument();
  });

  it("does not repeat the resident name as a page heading", async () => {
    render(<AssessmentEntryPage />);
    await screen.findByRole("button", { name: /Katz ADL Index/i });
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "New assessment" })).toBeInTheDocument();
  });
});

describe("AssessmentEntryPage selected instrument", () => {
  it("keeps the instrument name as the heading and shows progress instead of a score", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);

    expect(
      screen.getByRole("heading", { level: 2, name: "Braden Scale for Predicting Pressure Sore Risk" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No score posted/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 2 sections completed");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Complete all required items to calculate the result.",
    );
    expect(screen.getByRole("button", { name: "Review assessment" })).toBeDisabled();
    expect(screen.getByText(/Unsaved assessment · 2 sections remaining/)).toBeInTheDocument();
  });

  it("never shows a total or an interpretation while a section is unanswered", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);
    answer("Sensory Perception", "Completely Limited");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("1 of 2 sections completed");
    expect(status).not.toHaveTextContent("Provisional");
    expect(status).not.toHaveTextContent(/very high|high|none/);
    expect(screen.getByRole("button", { name: "Review assessment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next unanswered" })).toBeInTheDocument();
  });

  it("labels a complete calculation as provisional and not yet recorded", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);
    answer("Sensory Perception", "Completely Limited");
    answer("Moisture", "Constantly Moist");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Provisional result");
    expect(status).toHaveTextContent("2 of 8");
    expect(status).toHaveTextContent("Very high");
    expect(status).toHaveTextContent("Not yet recorded");
    expect(screen.getByRole("button", { name: "Review assessment" })).toBeEnabled();
    expect(harness.inserts).toHaveLength(0);
  });

  it("renders each section as a navigable, keyboard-reachable radio group", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);

    const nav = screen.getByRole("navigation", { name: "Assessment sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "#assessment-section-sensory_perception",
      "#assessment-section-moisture",
    ]);
    expect(links[0]).toHaveTextContent("1. Sensory Perception, unanswered");

    const group = screen.getByRole("group", { name: /Sensory Perception/i });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios.every((r) => (r as HTMLInputElement).name === "sensory_perception")).toBe(true);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(within(group).getByText("4 points")).toBeInTheDocument();

    answer("Sensory Perception", "Very Limited");
    expect(links[0]).toHaveTextContent("1. Sensory Perception, answered");
  });
});

describe("AssessmentEntryPage changing instruments", () => {
  it("switches immediately when nothing has been answered", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);
    fireEvent.click(screen.getByRole("button", { name: "Change assessment" }));
    expect(await screen.findByRole("button", { name: /Katz ADL Index/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before discarding answers, and never carries them into another instrument", async () => {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Braden Scale/i);
    answer("Sensory Perception", "Completely Limited");

    fireEvent.click(screen.getByRole("button", { name: "Change assessment" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "discards the 1 answer entered for Braden Scale for Predicting Pressure Sore Risk",
    );

    fireEvent.click(within(alert).getByRole("button", { name: "Keep answers" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 sections completed");

    fireEvent.click(screen.getByRole("button", { name: "Change assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and change" }));
    await pickInstrument(/Katz ADL Index/i);

    expect(screen.getByRole("status")).toHaveTextContent("0 of 2 sections completed");
    const group = screen.getByRole("group", { name: /Bathing/i });
    expect(within(group).getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });
});

describe("AssessmentEntryPage review and record", () => {
  async function completeKatz() {
    render(<AssessmentEntryPage />);
    await pickInstrument(/Katz ADL Index/i);
    answer("Bathing", "Dependent");
    answer("Dressing", "Independent");
    fireEvent.click(screen.getByRole("button", { name: "Review assessment" }));
    await screen.findByRole("heading", { level: 2, name: "Review Katz ADL Index" });
  }

  it("shows every answer with points and a provisional total before recording", async () => {
    await completeKatz();

    const table = screen.getByRole("table", { name: /Answers for Katz ADL Index/i });
    expect(within(table).getByText("1. Bathing")).toBeInTheDocument();
    expect(within(table).getByText("Dependent")).toBeInTheDocument();
    expect(within(table).getByText("2. Dressing")).toBeInTheDocument();
    expect(within(table).getByText("Independent")).toBeInTheDocument();
    expect(within(table).getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Sample Nurse")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Provisional result");
    expect(screen.getByRole("status")).toHaveTextContent("Not yet recorded");
    expect(harness.inserts).toHaveLength(0);
  });

  it("records once with resident, facility, author, instrument, answers and result attached", async () => {
    await completeKatz();
    fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));

    await screen.findByRole("heading", { level: 2, name: "Assessment recorded" });
    expect(harness.inserts).toHaveLength(1);
    expect(harness.inserts[0].payload).toMatchObject({
      resident_id: ANONYMOUS_RESIDENT_ID,
      facility_id: ANONYMOUS_FACILITY_ID,
      organization_id: ANONYMOUS_ORG_ID,
      assessment_type: "katz_adl",
      total_score: 1,
      risk_level: "level_2",
      scores: { bathing: 1, dressing: 0 },
      assessed_by: ANONYMOUS_USER_ID,
      created_by: ANONYMOUS_USER_ID,
    });
    const recorded = screen.getByRole("status");
    expect(recorded).toHaveTextContent("Katz ADL Index");
    expect(recorded).toHaveTextContent("Recorded score 1 of 2");
    expect(recorded).toHaveTextContent("Level 2");
    expect(recorded).toHaveTextContent("Recorded to Sample Resident's assessment history");
    expect(screen.getByRole("link", { name: "View history" })).toHaveAttribute(
      "href",
      `/admin/residents/${ANONYMOUS_RESIDENT_ID}/assessments`,
    );
    // Katz feeds the acuity composite; the resident summary update happened once.
    expect(harness.updates.filter((u) => u.table === "residents")).toHaveLength(1);
  });

  it("keeps the answers and stays on review when the save fails", async () => {
    harness.failInsertWith = "connection lost";
    await completeKatz();
    fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The assessment was not recorded. Your answers are kept.");
    expect(alert).toHaveTextContent("connection lost");
    expect(screen.getByRole("heading", { level: 2, name: "Review Katz ADL Index" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Dependent")).toBeInTheDocument();
    expect(harness.inserts).toHaveLength(0);

    harness.failInsertWith = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry recording" }));
    await screen.findByRole("heading", { level: 2, name: "Assessment recorded" });
    expect(harness.inserts).toHaveLength(1);
  });

  it("warns about a same-day entry and requires an explicit second record", async () => {
    harness.sameDayCount = 1;
    await completeKatz();

    await waitFor(() =>
      expect(screen.getByText(/already on record for Sample Resident/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Record anyway" })).toBeInTheDocument();
    expect(harness.inserts).toHaveLength(0);
  });
});

describe("AssessmentEntryPage held instrument (COL-430)", () => {
  it("lists a held instrument once as disabled text with nothing selectable", async () => {
    harness.includeHeldPhq9 = true;
    render(<AssessmentEntryPage />);
    await screen.findByRole("button", { name: /Katz ADL Index/i });

    // Named once, with the hold reason, and not as a control.
    expect(screen.getByText("PHQ-9")).toBeInTheDocument();
    expect(screen.getAllByText("PHQ-9")).toHaveLength(1);
    expect(screen.getByText("PHQ-9 cannot be recorded in Haven yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /PHQ-9/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /PHQ-9/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /PHQ-9/ })).toBeNull();

    const held = screen.getByText("PHQ-9").closest("[aria-disabled]");
    expect(held).not.toBeNull();
    expect(held).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the unheld instruments selectable alongside it", async () => {
    harness.includeHeldPhq9 = true;
    render(<AssessmentEntryPage />);

    const braden = await screen.findByRole("button", { name: /Braden Scale/i });
    expect(braden).toBeEnabled();
    fireEvent.click(braden);
    expect(
      await screen.findByRole("heading", { level: 2, name: /Braden Scale/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 2 sections completed");
  });

  it("shows the hold message and keeps the answers when the database refuses the save", async () => {
    // The instrument was held after this picker loaded, so the form opened.
    harness.failInsertWith = "assessment_instrument_held";
    render(<AssessmentEntryPage />);
    await pickInstrument(/Katz ADL Index/i);
    answer("Bathing", "Dependent");
    answer("Dressing", "Independent");
    fireEvent.click(screen.getByRole("button", { name: "Review assessment" }));
    await screen.findByRole("heading", { level: 2, name: "Review Katz ADL Index" });
    fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Katz ADL Index is on hold and was not recorded.");
    // The raw database sentinel never reaches the operator.
    expect(alert).not.toHaveTextContent("assessment_instrument_held");

    // Answers are still on screen and nothing was recorded.
    const table = screen.getByRole("table", { name: /Answers for Katz ADL Index/i });
    expect(within(table).getByText("Dependent")).toBeInTheDocument();
    expect(within(table).getByText("Independent")).toBeInTheDocument();
    expect(harness.inserts).toHaveLength(0);
  });
});
