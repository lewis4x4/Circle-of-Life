import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  server: {} as Record<string, unknown>, patch: {} as Record<string, unknown>, filters: [] as [string, unknown][],
  delay: null as Promise<void> | null, user: { id: "editor" } as { id: string } | null, saves: 0, client: {} as object,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "lead" }), usePathname: () => "/admin/referrals/lead", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: "11111111-1111-1111-1111-111111111111" }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));

beforeEach(() => {
  mocks.server = { id: "lead", facility_id: "11111111-1111-1111-1111-111111111111", first_name: "Synthetic", last_name: "Prospect", status: "contacted", notes: null,
    tour_owner_user_id: "assigned-staff", tour_scheduled_for: null, tour_completed_at: null, converted_resident_id: null,
    updated_at: "2026-09-08T12:00:00Z", created_at: "2026-09-08T11:00:00Z", referral_sources: { name: "Synthetic source" } };
  mocks.patch = {}; mocks.filters = []; mocks.saves = 0; mocks.delay = null; mocks.user = { id: "editor" };
  mocks.client = { from: (table: string) => {
    const filters: [string, unknown][] = [];
    const query = { select: () => query, is: () => query, not: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: table === "referral_leads" ? { ...mocks.server } : null, error: null }),
      update: (patch: Record<string, unknown>) => { mocks.patch = patch; return query; },
      single: async () => {
        if (mocks.delay) await mocks.delay;
        mocks.filters = filters;
        if (filters.some(([key, value]) => mocks.server[key] !== value)) return { data: null, error: { code: "PGRST116", message: "No row matched" } };
        mocks.server = { ...mocks.server, ...mocks.patch }; mocks.saves += 1;
        return { data: { ...mocks.server }, error: null };
      },
    };
    return query;
  } };
});
afterEach(cleanup);

async function enterTour() {
  const input = await screen.findByLabelText("Tour scheduled for (Eastern Time)");
  fireEvent.change(input, { target: { value: "2026-09-09T09:00" } });
  return input;
}

describe("referral tour edits", () => {
  it("changes tour dates without assigning the editor as tour owner", async () => {
    render(<Page />); await enterTour();
    await userEvent.click(screen.getByRole("button", { name: "Save tour details" }));
    await waitFor(() => expect(mocks.saves).toBe(1));
    expect(mocks.patch).not.toHaveProperty("tour_owner_user_id");
    expect(mocks.server.tour_owner_user_id).toBe("assigned-staff");
    expect(mocks.server.tour_scheduled_for).toBe("2026-09-09T13:00:00.000Z");
    expect(mocks.server.updated_by).toBe("editor");
    expect(mocks.filters).toContainEqual(["updated_at", "2026-09-08T12:00:00Z"]);
  });

  it("preserves a newer assignment and stage and retains unsaved dates after a stale save", async () => {
    render(<Page />); const input = await enterTour();
    mocks.server = { ...mocks.server, tour_owner_user_id: "new-assignee", status: "application_pending", updated_at: "2026-09-08T13:00:00Z" };
    await userEvent.click(screen.getByRole("button", { name: "Save tour details" }));
    expect(await screen.findByText(/This lead changed or is no longer available/)).toBeInTheDocument();
    expect(mocks.saves).toBe(0);
    expect(mocks.server.tour_owner_user_id).toBe("new-assignee");
    expect(mocks.server.status).toBe("application_pending");
    expect(input).toHaveValue("2026-09-09T09:00");
  });

  it("does not assign an unassigned tour merely because someone edited its date", async () => {
    mocks.server.tour_owner_user_id = null;
    render(<Page />); await enterTour();
    await userEvent.click(screen.getByRole("button", { name: "Save tour details" }));
    await waitFor(() => expect(mocks.saves).toBe(1));
    expect(mocks.server.tour_owner_user_id).toBeNull();
  });

  it("rejects a save when the editor session is missing", async () => {
    mocks.user = null;
    render(<Page />); await enterTour();
    await userEvent.click(screen.getByRole("button", { name: "Save tour details" }));
    expect(await screen.findByText(/Session expired/)).toBeInTheDocument();
    expect(mocks.saves).toBe(0);
  });
});


it("serializes section saves and preserves previously entered notes after a tour save", async () => {
  let release!: () => void;
  mocks.delay = new Promise<void>((resolve) => { release = resolve; });
  render(<Page />); await enterTour();
  const notes = screen.getByRole("textbox", { name: "Lead notes" });
  await userEvent.type(notes, "Unsaved follow-up note");
  await userEvent.click(screen.getByRole("button", { name: "Save tour details" }));
  expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
  expect(notes).toBeDisabled();
  release();
  await waitFor(() => expect(mocks.saves).toBe(1));
  expect(notes).toHaveValue("Unsaved follow-up note");
  expect(mocks.server.notes).toBeNull();
  mocks.delay = null;
  await userEvent.click(screen.getByRole("button", { name: "Save notes" }));
  await waitFor(() => expect(mocks.saves).toBe(2));
  expect(mocks.server.notes).toBe("Unsaved follow-up note");
});
