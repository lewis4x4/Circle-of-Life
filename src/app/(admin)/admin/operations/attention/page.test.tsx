import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NeedsAttentionPage from "./page";

const env = vi.hoisted(() => ({
  query: "",
  actor: "person",
  role: "owner",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: env.replace }),
  useSearchParams: () => new URLSearchParams(env.query),
  usePathname: () => "/admin/operations/attention",
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: { id: env.actor },
    fullName: "Dana",
    appRole: env.role,
    loading: false,
  }),
}));
vi.mock("../work/_components/receipt-history", () => ({
  localTime: (value: unknown) => String(value),
  ReceiptHistory: ({ occurrenceId }: { occurrenceId: string }) => (
    <p>Exact receipt chain: {occurrenceId}</p>
  ),
}));
const categories = [
  "overdue",
  "unresolved_issues",
  "missing_evidence",
  "waiting",
  "unassigned",
  "configuration_needed",
];
const counts = () =>
  Object.fromEntries(
    categories.map((key) => [
      key,
      {
        count: key === "unresolved_issues" ? 1101 : 0,
        denominator: 1200,
        unit: "unresolved issues",
        definition: "Complete permitted population",
      },
    ]),
  );
function reply(extra = {}) {
  return {
    facility_id: null,
    facilities: [
      { id: "site", name: "Homewood" },
      { id: "other", name: "Other facility" },
    ],
    category: null,
    counts: counts(),
    items: [
      {
        key: "site:issue:failed-generator",
        source_kind: "issue",
        source_id: "failed-generator",
        facility_id: "site",
        facility_name: "Homewood",
        facility_timezone: "America/New_York",
        activity_id: "generator",
        activity_name: "Generator check",
        categories: ["unresolved_issues"],
        reason: "Generator failed despite performed check",
        status: "open",
        severity: "high",
        at: null,
        task_id: "exact-occurrence",
        issue_id: "failed-generator",
        detail: {
          summary: "Generator failed despite performed check",
          owner_user_id: null,
          owner_current: false,
          next_action: "Assign a current owner",
        },
      },
    ],
    total: 1101,
    next_cursor: "opaque-page-2",
    high_severity_issues: 1,
    partial: [],
    all_clear: false,
    ...extra,
  };
}
const ok = (body = reply()) => ({ ok: true, json: async () => body });
beforeEach(() => {
  env.query = "";
  env.actor = "person";
  env.role = "owner";
  env.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
});
function openExact() {
  const element = screen.getByText("View exact issue details")
    .parentElement as HTMLDetailsElement;
  element.open = true;
  fireEvent(element, new Event("toggle"));
}

describe("Needs attention", () => {
  it("renders server counts beyond a page and drills to the precise unresolved issue and occurrence", async () => {
    render(<NeedsAttentionPage />);
    await screen.findByText("Matching records: 1101. This page shows 1.");
    expect(
      screen.getByText("High severity unresolved issues: 1"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Unresolved issues 1101 Population: 1200/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Status: Open · Severity: High"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Exact receipt chain: exact-occurrence"),
    ).not.toBeInTheDocument();
    openExact();
    await screen.findByText("Exact receipt chain: exact-occurrence");
    expect(screen.getByText("Assign a current owner")).toBeInTheDocument();
    expect(
      screen.getByText(/Issue remains unresolved independently/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/attention?cursor=opaque-page-2",
      { scroll: false },
    );
  });
  it("resets pagination when changing facility or category", async () => {
    env.query = "cursor=old&category=unresolved_issues";
    render(<NeedsAttentionPage />);
    fireEvent.change(await screen.findByLabelText("Facility"), {
      target: { value: "other" },
    });
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/attention?category=unresolved_issues&facility_id=other",
      { scroll: false },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Missing evidence/ }));
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/attention?category=missing_evidence",
      { scroll: false },
    );
  });
  it("clears old category data and ignores an out-of-order response", async () => {
    let resolveOld!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve as unknown as typeof resolveOld;
          }),
      )
      .mockResolvedValueOnce(
        ok(reply({ category: "waiting", total: 0, items: [] })) as Response,
      );
    const view = render(<NeedsAttentionPage />);
    env.query = "category=waiting";
    view.rerender(<NeedsAttentionPage />);
    await screen.findByText("Matching records: 0. This page shows 0.");
    resolveOld(ok());
    await waitFor(() =>
      expect(
        screen.queryByText("Generator failed despite performed check"),
      ).not.toBeInTheDocument(),
    );
  });
  it("discards previous actor data and respects revocation", async () => {
    const view = render(<NeedsAttentionPage />);
    await screen.findByText("Matching records: 1101. This page shows 1.");
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    env.actor = "second-person";
    view.rerender(<NeedsAttentionPage />);
    expect(
      screen.queryByText("Matching records: 1101. This page shows 1."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading attention");
    env.role = "resident";
    view.rerender(<NeedsAttentionPage />);
    expect(
      screen.getByText("Needs attention is unavailable for this person."),
    ).toBeInTheDocument();
  });
  it("keeps later-page failures distinct from zero and supports refreshing a changed dataset", async () => {
    env.query = "category=unresolved_issues&cursor=old";
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 409 } as Response);
    render(<NeedsAttentionPage />);
    await screen.findByText(
      "Needs attention is unavailable. Counts are not confirmed zero.",
    );
    expect(screen.queryByText(/No matching records/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry attention" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload first page" }),
    );
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/attention?category=unresolved_issues",
      { scroll: false },
    );
  });
  it("keeps severe counts visible outside the selected category and does not clear empty access", async () => {
    env.query = "category=missing_evidence";
    vi.mocked(fetch).mockResolvedValue(
      ok(
        reply({
          category: "missing_evidence",
          items: [],
          total: 0,
          next_cursor: null,
        }),
      ) as Response,
    );
    const view = render(<NeedsAttentionPage />);
    await screen.findByText("High severity unresolved issues: 1");
    expect(
      screen.queryByText(
        "No attention items found in the checked populations.",
      ),
    ).not.toBeInTheDocument();
    env.actor = "no-facilities";
    const zero = Object.fromEntries(
      categories.map((key) => [
        key,
        { ...counts()[key], count: 0, denominator: 0 },
      ]),
    );
    vi.mocked(fetch).mockResolvedValue(
      ok(
        reply({
          counts: zero,
          facilities: [],
          items: [],
          total: 0,
          high_severity_issues: 0,
          all_clear: true,
        }),
      ) as Response,
    );
    view.rerender(<NeedsAttentionPage />);
    await screen.findByText("No accessible facilities.");
    expect(
      screen.queryByText(
        "No attention items found in the checked populations.",
      ),
    ).not.toBeInTheDocument();
  });
  it("labels and deduplicates scoped read failures without exposing internal identifiers", async () => {
    const facilityId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(fetch).mockResolvedValue(
      ok(
        reply({
          facilities: [{ id: facilityId, name: "Homewood" }],
          partial: [
            `${facilityId}:receipt:private-receipt-one`,
            `${facilityId}:receipt:private-receipt-two`,
            `${facilityId}:receipts`,
            `${facilityId}:ownership:private-person`,
            "unknown-facility:unexpected:private-record",
          ],
        }),
      ) as Response,
    );
    render(<NeedsAttentionPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Homewood: evidence details unavailable");
    expect(
      alert.textContent?.match(/Homewood: evidence details unavailable/g),
    ).toHaveLength(1);
    expect(alert).toHaveTextContent("Homewood: assignment details unavailable");
    expect(alert).toHaveTextContent("Facility: attention details unavailable");
    expect(alert.textContent).not.toContain(facilityId);
    expect(alert.textContent).not.toMatch(
      /private-|unknown-facility|unexpected/,
    );
  });
  it("never claims an empty queue on partial or unknown counts and passes accessibility checks", async () => {
    const uncertain = counts();
    uncertain.configuration_needed = {
      ...uncertain.configuration_needed,
      count: null,
      denominator: null,
    };
    vi.mocked(fetch).mockResolvedValue(
      ok(
        reply({
          counts: uncertain,
          items: [],
          total: null,
          partial: ["site:requirements"],
          all_clear: true,
        }),
      ) as Response,
    );
    const { container } = render(<NeedsAttentionPage />);
    await screen.findByText(
      "No details loaded; this does not confirm an empty queue.",
    );
    expect(
      screen.queryByText(
        "No attention items found in the checked populations.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /^Configuration needed/ }),
      ).getAllByText(/Unavailable/),
    ).toHaveLength(2);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
