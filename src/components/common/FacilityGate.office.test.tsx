import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminAcknowledgmentsDashboardPage from "@/app/(admin)/admin/acknowledgments/page";
import MyAcknowledgmentsPage from "@/app/(admin)/admin/acknowledgments/my/page";
import AdminInternalFormsPage from "@/app/(admin)/admin/forms/page";
import FrontDeskPage from "@/app/(admin)/admin/front-desk/page";
import HandoffPage from "@/app/(admin)/admin/handoff/page";
import AdminMeetingsHubPage from "@/app/(admin)/admin/meetings/page";
import { useFacilityStore } from "@/hooks/useFacilityStore";

const HOMEWOOD = { id: "11111111-1111-4111-8111-111111111111", name: "Homewood Lodge" };
const OAKRIDGE = { id: "22222222-2222-4222-8222-222222222222", name: "Oakridge ALF" };

type Call = { table: string; method: string; args: unknown[] };
const calls = vi.hoisted(() => [] as Call[]);
const rowsByTable = vi.hoisted(() => ({}) as Record<string, unknown[]>);

// A PostgREST-shaped builder: every filter chains, awaiting resolves the table's rows.
function queryFor(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop: string) {
      if (prop === "then") {
        const rows = rowsByTable[table] ?? [];
        return (resolve: (value: unknown) => void) => resolve({ data: rows, error: null, count: rows.length });
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => Promise.resolve({ data: (rowsByTable[table] ?? [])[0] ?? null, error: null });
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: prop, args });
        return chain;
      };
    },
  });
  return chain;
}

// The real browser client is a singleton; pages put it in effect dependencies.
const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () =>
    (client.current ??= {
      from: (table: string) => queryFor(table),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
    }),
}));
vi.mock("@/lib/office/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/office/meetings")>()),
  fetchActorContext: () => Promise.resolve({ userId: "user-1", organizationId: "org-1" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" }, loading: false, appRole: "owner" }),
}));

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(rowsByTable)) delete rowsByTable[key];
  useFacilityStore.setState({
    selectedFacilityId: null,
    availableFacilities: [HOMEWOOD, OAKRIDGE],
    facilitiesFetchedAt: Date.now(),
    facilitiesCacheUserId: "user-1",
  });
});

afterEach(() => {
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: [], facilitiesCacheUserId: null });
});

describe("COL-651 office pages under All facilities", () => {
  it("acknowledgments: no 'New requirement' toggle that opens nothing; the gate offers the facilities", () => {
    render(<AdminAcknowledgmentsDashboardPage />);
    expect(screen.queryByRole("button", { name: /new requirement/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
  });

  it("acknowledgments: the create button is back once a facility is chosen", () => {
    useFacilityStore.setState({ selectedFacilityId: HOMEWOOD.id });
    render(<AdminAcknowledgmentsDashboardPage />);
    expect(screen.getByRole("button", { name: /new requirement/i })).toBeInTheDocument();
    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
  });

  it("forms: no 'New form' toggle that opens nothing", () => {
    render(<AdminInternalFormsPage />);
    expect(screen.queryByRole("button", { name: /new form/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
  });

  it("meetings: no dimmed 'New meeting' link while gated", () => {
    render(<AdminMeetingsHubPage />);
    expect(screen.queryByRole("link", { name: /new meeting/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
  });

  it("front desk and handoff: no zero counts beside the gate", () => {
    const { unmount } = render(<FrontDeskPage />);
    expect(screen.queryByText(/on site ·/)).not.toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
    unmount();

    render(<HandoffPage />);
    expect(screen.queryByText(/unacknowledged on this shift/)).not.toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
  });

  it("my acknowledgments is a personal list: never gated, spans every facility the reader can see", async () => {
    rowsByTable.user_profiles = [{ id: "user-1", full_name: "Pat Reader", app_role: "owner" }];
    rowsByTable.document_acknowledgment_requirements = [
      {
        id: "req-1",
        facility_id: OAKRIDGE.id,
        document_id: "doc-1",
        document_title: "Fire safety SOP",
        required_roles: ["owner"],
        require_signature: true,
        due_date: null,
        note: null,
        is_active: true,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];

    render(<MyAcknowledgmentsPage />);

    expect(await screen.findByText("Fire safety SOP")).toBeInTheDocument();
    expect(screen.getByText(/Oakridge ALF ·/)).toBeInTheDocument();
    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.table === "document_acknowledgment_requirements" && c.method === "eq" && c.args[0] === "facility_id",
      ),
    ).toBe(false);
  });

  it("my acknowledgments still narrows to the chosen facility when one is selected", async () => {
    useFacilityStore.setState({ selectedFacilityId: HOMEWOOD.id });
    rowsByTable.user_profiles = [{ id: "user-1", full_name: "Pat Reader", app_role: "owner" }];
    render(<MyAcknowledgmentsPage />);

    expect(await screen.findByText(/you are caught up/)).toBeInTheDocument();
    expect(calls).toContainEqual({
      table: "document_acknowledgment_requirements",
      method: "eq",
      args: ["facility_id", HOMEWOOD.id],
    });
  });
});
