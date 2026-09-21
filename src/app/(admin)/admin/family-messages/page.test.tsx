import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffMessageRow, StaffMessageThread } from "@/lib/admin/family-messages-data";

import StaffFamilyMessagesPage from "./page";

const FACILITY_A = "11111111-1111-4111-8111-111111111111";
const FACILITY_B = "44444444-4444-4444-8444-444444444444";
const RESIDENT_A = "22222222-2222-4222-8222-222222222222";
const RESIDENT_B = "33333333-3333-4333-8333-333333333333";
const RESIDENT_C = "66666666-6666-4666-8666-666666666666";

type ResidentRecord = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
};

const mocks = vi.hoisted(() => ({
  facilityId: "11111111-1111-4111-8111-111111111111",
  guards: [] as Array<(id: string | null) => boolean>,
  delayRoster: false,
  rosterRequests: [] as Array<{
    facilityId: string;
    resolve: (result: { data: ResidentRecord[]; error: null }) => void;
  }>,
  residentsByFacility: new Map<string, ResidentRecord[]>(),
  postStaffMessage: vi.fn(),
  fetchStaffMessageThreads: vi.fn(),
  fetchStaffMessagesForResident: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: Object.assign(
    (selector?: (state: { selectedFacilityId: string | null }) => unknown) => {
      const state = { selectedFacilityId: mocks.facilityId };
      return typeof selector === "function" ? selector(state) : state;
    },
    {
      getState: () => ({
        selectedFacilityId: mocks.facilityId,
        registerFacilityChangeGuard: (guard: (id: string | null) => boolean) => {
          mocks.guards.push(guard);
          return () => {
            const index = mocks.guards.indexOf(guard);
            if (index >= 0) mocks.guards.splice(index, 1);
          };
        },
      }),
    },
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        is: () => builder,
        order: () => builder,
        limit: () => {
          const facilityId = filters.facility_id ?? "";
          if (mocks.delayRoster) {
            return new Promise<{ data: ResidentRecord[]; error: null }>((resolve) => {
              mocks.rosterRequests.push({ facilityId, resolve });
            });
          }
          return Promise.resolve({
            data: mocks.residentsByFacility.get(facilityId) ?? [],
            error: null,
          });
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/admin/family-messages-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/family-messages-data")>(
    "@/lib/admin/family-messages-data",
  );
  return {
    ...actual,
    fetchStaffMessageThreads: mocks.fetchStaffMessageThreads,
    fetchStaffMessagesForResident: mocks.fetchStaffMessagesForResident,
    postStaffMessage: mocks.postStaffMessage,
  };
});

function resident(id: string, first: string, last: string): ResidentRecord {
  return { id, first_name: first, last_name: last, preferred_name: null };
}

function thread(residentId: string, residentName: string): StaffMessageThread {
  return {
    residentId,
    residentName,
    roomLabel: "Room 1",
    facilityName: "Homewood",
    lastMessageBody: `${residentName} posted note`,
    lastMessageAt: "Sep 1",
    lastMessageAtIso: "2026-09-01T15:00:00.000Z",
    lastAuthorKind: "staff",
    messageCount: 1,
    latestDeliveryMethod: "portal_only",
    latestFamilyAcknowledgedAt: null,
    triageItemId: null,
    triageStatus: null,
    triageKeywords: [],
  };
}

function message(id: string, body: string): StaffMessageRow {
  return {
    id,
    authorName: "Nurse",
    authorKind: "staff",
    body,
    createdAt: "Sep 1, 3:00 PM",
    deliveryMethod: "portal_only",
    familyAcknowledgedAt: null,
  };
}

async function openHub() {
  render(<StaffFamilyMessagesPage />);
  expect(await screen.findByRole("heading", { name: /family portal notes/i })).toBeInTheDocument();
  return screen.findByLabelText("Resident");
}

describe("staff family bulletin drafts", () => {
  beforeEach(() => {
    mocks.facilityId = FACILITY_A;
    mocks.guards.splice(0, mocks.guards.length);
    mocks.delayRoster = false;
    mocks.rosterRequests.splice(0, mocks.rosterRequests.length);
    mocks.residentsByFacility = new Map([
      [FACILITY_A, [resident(RESIDENT_A, "Ada", "Alpha"), resident(RESIDENT_B, "Bea", "Beta")]],
      [FACILITY_B, [resident(RESIDENT_C, "Cy", "Gamma")]],
    ]);
    mocks.postStaffMessage.mockReset();
    mocks.postStaffMessage.mockResolvedValue({ ok: true });
    mocks.fetchStaffMessageThreads.mockReset();
    mocks.fetchStaffMessageThreads.mockResolvedValue({ ok: true, threads: [] });
    mocks.fetchStaffMessagesForResident.mockReset();
    mocks.fetchStaffMessagesForResident.mockResolvedValue({
      ok: true,
      messages: [],
      residentName: "Resident",
    });
  });

  it("keeps each resident's draft when switching away and back", async () => {
    const user = userEvent.setup();
    const residentSelect = await openHub();

    await user.selectOptions(residentSelect, RESIDENT_A);
    await user.type(screen.getByPlaceholderText(/write an update/i), "Ada ate lunch.");
    expect(screen.getByText("Recipient: Ada Alpha")).toBeInTheDocument();

    await user.selectOptions(residentSelect, RESIDENT_B);
    const textarea = screen.getByPlaceholderText(/write an update/i);
    expect(textarea).toHaveValue("");
    expect(screen.getByText("Recipient: Bea Beta")).toBeInTheDocument();
    await user.type(textarea, "Bea had a visitor.");

    await user.selectOptions(residentSelect, RESIDENT_A);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Ada ate lunch.");
    expect(screen.getByText("Recipient: Ada Alpha")).toBeInTheDocument();

    await user.selectOptions(residentSelect, RESIDENT_B);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Bea had a visitor.");
  });

  it("posts the visible resident only, and a second click does not send another note", async () => {
    const user = userEvent.setup();
    let resolvePost: (value: { ok: true }) => void = () => {};
    mocks.postStaffMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const residentSelect = await openHub();

    await user.selectOptions(residentSelect, RESIDENT_A);
    await user.type(screen.getByPlaceholderText(/write an update/i), "Ada ate lunch.");
    await user.selectOptions(residentSelect, RESIDENT_B);
    await user.type(screen.getByPlaceholderText(/write an update/i), "Bea had a visitor.");

    const postButton = screen.getByRole("button", { name: /post update/i });
    fireEvent.click(postButton);
    fireEvent.click(postButton);

    await waitFor(() => expect(mocks.postStaffMessage).toHaveBeenCalledTimes(1));
    expect(mocks.postStaffMessage).toHaveBeenCalledWith(
      expect.anything(),
      RESIDENT_B,
      "Bea had a visitor.",
      "portal_only",
      FACILITY_A,
    );
    expect(screen.getByLabelText("Resident")).toBeDisabled();
    expect(mocks.guards.some((guard) => guard(FACILITY_B) === false)).toBe(true);

    resolvePost({ ok: true });
    await waitFor(() => expect(screen.getByLabelText("Resident")).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText("Resident"), RESIDENT_A);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Ada ate lunch.");
    await user.selectOptions(screen.getByLabelText("Resident"), RESIDENT_B);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("");
  });

  it("keeps a failed post's draft and does not describe it as posted", async () => {
    const user = userEvent.setup();
    mocks.postStaffMessage.mockResolvedValue({
      ok: false,
      error: "permission denied for table family_portal_messages",
    });
    const residentSelect = await openHub();
    await user.selectOptions(residentSelect, RESIDENT_A);
    await user.type(screen.getByPlaceholderText(/write an update/i), "Ada ate lunch.");
    await user.click(screen.getByRole("button", { name: /post update/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/permission denied/i);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Ada ate lunch.");
  });

  it("ignores a stale resident log after the operator opens someone else", async () => {
    const user = userEvent.setup();
    mocks.fetchStaffMessageThreads.mockResolvedValue({
      ok: true,
      threads: [thread(RESIDENT_A, "Ada Alpha"), thread(RESIDENT_B, "Bea Beta")],
    });
    let resolveAda: (value: { ok: true; messages: StaffMessageRow[]; residentName: string }) => void =
      () => {};
    mocks.fetchStaffMessagesForResident.mockImplementation((_client, residentId: string) => {
      if (residentId === RESIDENT_A) {
        return new Promise((resolve) => {
          resolveAda = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        residentName: "Bea Beta",
        messages: [message("msg-b", "Bea family update")],
      });
    });

    render(<StaffFamilyMessagesPage />);
    await user.click(await screen.findByRole("button", { name: /Ada Alpha/ }));
    await user.click(screen.getByRole("button", { name: /back to bulletin notes/i }));
    await user.click(await screen.findByRole("button", { name: /Bea Beta/ }));
    expect(await screen.findByText("Bea family update")).toBeInTheDocument();

    resolveAda({
      ok: true,
      residentName: "Ada Alpha",
      messages: [message("msg-a", "SECRET ABOUT ADA")],
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bea Beta" })).toBeInTheDocument());
    expect(screen.queryByText("SECRET ABOUT ADA")).not.toBeInTheDocument();
    expect(screen.getByText("Bea family update")).toBeInTheDocument();
  });

  it("names the resident just opened before that log returns, and drops the previous notes if the load fails", async () => {
    const user = userEvent.setup();
    mocks.fetchStaffMessageThreads.mockResolvedValue({
      ok: true,
      threads: [thread(RESIDENT_A, "Ada Alpha"), thread(RESIDENT_B, "Bea Beta")],
    });
    let resolveAda: (value: { ok: true; messages: StaffMessageRow[]; residentName: string }) => void =
      () => {};
    let resolveBea: (value: { ok: false; error: string }) => void = () => {};
    mocks.fetchStaffMessagesForResident.mockImplementation((_client, residentId: string) => {
      if (residentId === RESIDENT_A) {
        return new Promise((resolve) => {
          resolveAda = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveBea = resolve;
      });
    });

    render(<StaffFamilyMessagesPage />);
    await user.click(await screen.findByRole("button", { name: /Ada Alpha/ }));
    expect(screen.getByRole("heading", { name: "Ada Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Recipient: Ada Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Recipient: none selected")).not.toBeInTheDocument();

    resolveAda({
      ok: true,
      residentName: "Ada Alpha",
      messages: [message("msg-a", "SECRET ABOUT ADA")],
    });
    expect(await screen.findByText("SECRET ABOUT ADA")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to bulletin notes/i }));
    await user.click(await screen.findByRole("button", { name: /Bea Beta/ }));
    expect(screen.getByRole("heading", { name: "Bea Beta" })).toBeInTheDocument();
    expect(screen.getByText("Recipient: Bea Beta")).toBeInTheDocument();
    expect(screen.queryByText("SECRET ABOUT ADA")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ada Alpha" })).not.toBeInTheDocument();

    resolveBea({ ok: false, error: "could not read bulletin notes" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load posted updates/i);
    expect(screen.queryByText("SECRET ABOUT ADA")).not.toBeInTheDocument();
    expect(screen.getByText("Recipient: Bea Beta")).toBeInTheDocument();
  });

  it("ignores a stale facility roster and drops a resident who is no longer in scope", async () => {
    const user = userEvent.setup();
    mocks.delayRoster = true;
    const { rerender } = render(<StaffFamilyMessagesPage />);
    expect(await screen.findByRole("heading", { name: /family portal notes/i })).toBeInTheDocument();
    expect(mocks.rosterRequests.map((request) => request.facilityId)).toContain(FACILITY_A);

    mocks.facilityId = FACILITY_B;
    rerender(<StaffFamilyMessagesPage />);
    await waitFor(() =>
      expect(mocks.rosterRequests.some((request) => request.facilityId === FACILITY_B)).toBe(true),
    );

    const stale = mocks.rosterRequests.find((request) => request.facilityId === FACILITY_A);
    stale?.resolve({
      data: [resident(RESIDENT_A, "Ada", "Alpha")],
      error: null,
    });
    expect(screen.queryByRole("option", { name: "Ada Alpha" })).not.toBeInTheDocument();

    const current = [...mocks.rosterRequests].reverse().find((request) => request.facilityId === FACILITY_B);
    current?.resolve({
      data: [resident(RESIDENT_C, "Cy", "Gamma")],
      error: null,
    });
    expect(await screen.findByRole("option", { name: "Cy Gamma" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ada Alpha" })).not.toBeInTheDocument();

    const residentSelect = screen.getByLabelText("Resident");
    await user.selectOptions(residentSelect, RESIDENT_C);
    expect(screen.getByText("Recipient: Cy Gamma")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/write an update/i), "Cy went outside.");

    mocks.delayRoster = false;
    mocks.facilityId = FACILITY_A;
    rerender(<StaffFamilyMessagesPage />);
    expect(await screen.findByRole("option", { name: "Ada Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Cy Gamma" })).not.toBeInTheDocument();
    expect(screen.getByText("Recipient: none selected")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Resident"), RESIDENT_A);
    await user.type(screen.getByPlaceholderText(/write an update/i), "Ada ate lunch.");
    mocks.facilityId = FACILITY_B;
    rerender(<StaffFamilyMessagesPage />);
    expect(await screen.findByRole("option", { name: "Cy Gamma" })).toBeInTheDocument();
    expect(screen.getByText("Recipient: none selected")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("Resident"), RESIDENT_C);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Cy went outside.");
    expect(screen.getByText("Recipient: Cy Gamma")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Resident"), "");
    mocks.facilityId = FACILITY_A;
    rerender(<StaffFamilyMessagesPage />);
    await user.selectOptions(await screen.findByLabelText("Resident"), RESIDENT_A);
    expect(screen.getByPlaceholderText(/write an update/i)).toHaveValue("Ada ate lunch.");
  });
});
