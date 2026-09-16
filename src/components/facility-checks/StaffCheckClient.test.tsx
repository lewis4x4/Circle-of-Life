import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffCheckClient } from "./StaffCheckClient";
import type { StaffCheckStateRow } from "@/lib/facility-checks/staff-check";
import type { StaffCheckSession } from "@/lib/facility-checks/load-staff-check";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const inserted: Record<string, unknown>[] = [];
const rpcCalls: { name: string }[] = [];
let nextState: StaffCheckStateRow[] = [];
let closeError: { message: string } | null = null;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        if (table === "staff_check_results") inserted.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (name: string) => {
      rpcCalls.push({ name });
      if (name === "staff_check_state") return Promise.resolve({ data: nextState, error: null });
      if (name === "close_staff_check_session") return Promise.resolve({ data: null, error: closeError });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function identity(overrides: Partial<StaffCheckStateRow> = {}): StaffCheckStateRow {
  return {
    subject_user_profile_id: "profile-1",
    subject_staff_id: "staff-1",
    display_name: "Test Staff A",
    role_label: "cna",
    facility_grant_count: 1,
    last_sign_in_at: null,
    is_active: true,
    duplicate_candidate_user_profile_ids: [],
    duplicate_candidate_staff_ids: [],
    duplicate_candidate_count: 0,
    latest_result: null,
    duplicate_of_user_profile_id: null,
    duplicate_of_staff_id: null,
    unmarked: true,
    fix_open: false,
    ...overrides,
  };
}

const session: StaffCheckSession = {
  id: "session-1",
  organizationId: "org-1",
  facilityId: "facility-1",
  startedAt: "2026-09-16T12:00:00Z",
  startedBy: "user-1",
  closedAt: null,
  closedBy: null,
};

function renderCheck(rows: StaffCheckStateRow[], overrides: Partial<Parameters<typeof StaffCheckClient>[0]> = {}) {
  return render(
    <StaffCheckClient
      session={session}
      initialRows={rows}
      initialHistory={[]}
      closedByName={null}
      loadError={null}
      facilityId="facility-1"
      organizationId="org-1"
      actorId="user-1"
      staffHref="/staff"
      grantsHref="/admin/settings/users"
      onRefresh={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  inserted.length = 0;
  rpcCalls.length = 0;
  nextState = [];
  closeError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("duplicate candidates", () => {
  it("badges only the identities the database suggested", () => {
    renderCheck([
      identity({ duplicate_candidate_count: 1, duplicate_candidate_staff_ids: ["staff-2"] }),
      identity({ subject_staff_id: "staff-2", subject_user_profile_id: "profile-2", display_name: "Test Staff B" }),
    ]);
    expect(screen.getAllByText("Possible duplicate")).toHaveLength(1);
  });

  it("opens a picker limited to suggestions, and records the target", async () => {
    const subject = identity({
      duplicate_candidate_count: 1,
      duplicate_candidate_staff_ids: ["staff-2"],
    });
    const suggested = identity({
      subject_staff_id: "staff-2",
      subject_user_profile_id: "profile-2",
      display_name: "Test Staff B",
    });
    const unrelated = identity({
      subject_staff_id: "staff-3",
      subject_user_profile_id: "profile-3",
      display_name: "Test Staff C",
    });
    renderCheck([subject, suggested, unrelated]);

    const subjectRow = screen.getByText("Test Staff A").closest("tr") as HTMLElement;
    await userEvent.click(within(subjectRow).getByRole("button", { name: "Duplicate of…" }));

    // Nothing is recorded until a target is named; the database refuses it too.
    expect(inserted).toHaveLength(0);
    const picker = within(subjectRow);
    expect(picker.getByRole("button", { name: "Test Staff B" })).toBeTruthy();
    expect(picker.queryByRole("button", { name: "Test Staff C" })).toBeNull();

    await userEvent.click(picker.getByRole("button", { name: "Test Staff B" }));
    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0]).toMatchObject({
      subject_staff_id: "staff-1",
      result: "duplicate_of",
      duplicate_of_staff_id: "staff-2",
    });
  });

  it("finds an identity outside the suggestions by search", async () => {
    const subject = identity({ duplicate_candidate_count: 0 });
    const other = identity({
      subject_staff_id: "staff-3",
      subject_user_profile_id: "profile-3",
      display_name: "Test Staff C",
    });
    renderCheck([subject, other]);
    const subjectRow = screen.getByText("Test Staff A").closest("tr") as HTMLElement;
    await userEvent.click(within(subjectRow).getByRole("button", { name: "Duplicate of…" }));
    await userEvent.type(
      within(subjectRow).getByLabelText("Search identities in this organization"),
      "Staff C",
    );
    expect(within(subjectRow).getByRole("button", { name: "Test Staff C" })).toBeTruthy();
  });
});

describe("recording a decision", () => {
  it("records keep in one tap", async () => {
    nextState = [identity({ unmarked: false, latest_result: "keep" })];
    renderCheck([identity()]);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0]).toMatchObject({ result: "keep", subject_staff_id: "staff-1" });
  });

  it("keeps a deactivation open until the identity really cannot act", async () => {
    renderCheck([identity({ unmarked: false, latest_result: "deactivate", fix_open: true })]);
    expect(screen.getByText("Still outstanding")).toBeTruthy();
    expect(screen.getByText(/ends employment and revokes the Haven login/)).toBeTruthy();

    // The offboard went through; the state function recomputes and it clears.
    nextState = [identity({ unmarked: false, latest_result: "deactivate", fix_open: false, is_active: false })];
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.queryByText("Still outstanding")).toBeNull());
  });

  it("offers the deactivate flow and the grant screen for a duplicate, and merges nothing", () => {
    renderCheck([
      identity({ unmarked: false, latest_result: "duplicate_of", fix_open: true, facility_grant_count: 2 }),
    ]);
    const open = screen.getByText("Still outstanding").closest("section") as HTMLElement;
    expect(within(open).getByRole("link", { name: "Open deactivate" }).getAttribute("href")).toBe("/staff/staff-1");
    expect(within(open).getByRole("link", { name: "Reassign facility grants" }).getAttribute("href")).toBe(
      "/admin/settings/users",
    );
    expect(within(open).getByText("2 facility grants to reassign in the grant screen.")).toBeTruthy();
    expect(within(open).getByText(/Nothing is merged/)).toBeTruthy();
  });
});

describe("close gating", () => {
  it("disables close while an identity is unresolved", () => {
    renderCheck([identity({ unmarked: false, latest_result: "keep" }), identity({ subject_staff_id: "staff-2" })]);
    expect(screen.getByRole("button", { name: "Close check" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/1 identity is still unresolved/)).toBeTruthy();
  });

  it("disables close while a deactivation has not gone through", () => {
    renderCheck([identity({ unmarked: false, latest_result: "deactivate", fix_open: true })]);
    expect(screen.getByRole("button", { name: "Close check" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks the database at zero, and reports what the refusal found", async () => {
    closeError = { message: "Staff check has 0 unresolved identity(ies) and 1 open fix(es)" };
    nextState = [identity({ unmarked: false, latest_result: "deactivate", fix_open: true })];
    renderCheck([identity({ unmarked: false, latest_result: "keep" })]);
    await userEvent.click(screen.getByRole("button", { name: "Close check" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("1 deactivation has not gone through yet"),
    );
  });
});

describe("a facility admin without this facility", () => {
  it("sees no identities, because the state function returns none", () => {
    // RLS filters the session out, so staff_check_state yields nothing and the
    // screen has no roster to leak.
    renderCheck([]);
    expect(screen.queryByText("Test Staff A")).toBeNull();
    expect(screen.getByTestId("staff-check-progress").textContent).toBe(
      "0 of 0 identities checked · 0 deactivations pending",
    );
    expect(screen.getByRole("button", { name: "Close check" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("a closed check", () => {
  it("renders read only with its summary", () => {
    renderCheck([identity({ unmarked: false, latest_result: "keep" })], {
      session: { ...session, closedAt: "2026-09-16T19:42:00Z", closedBy: "user-1" },
      closedByName: "Test Admin A",
    });
    expect(screen.getByTestId("staff-check-progress").textContent).toContain("1 of 1 resolved");
    expect(screen.queryByRole("button", { name: "Close check" })).toBeNull();
    const control = screen.getByRole("button", { name: "Keep" }).closest("fieldset");
    expect((control as HTMLFieldSetElement).disabled).toBe(true);
  });
});
