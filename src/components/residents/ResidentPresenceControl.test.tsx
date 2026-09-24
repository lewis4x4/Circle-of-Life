import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { ResidentPresenceControl } from "./ResidentPresenceControl";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  getUser: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, message: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      update: mocks.update,
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { status: "hospital_hold", hold_case_manager_notified_at: "2026-09-20T12:00:00Z", facility_id: "fac-1", organization_id: "org-1" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/operating-rules/operating-rules", () => ({ loadMovementBackdateWindowDays: async () => 3 }));

beforeEach(() => {
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.getUser.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq, in: vi.fn() });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "actor-1" } } });
});
afterEach(() => cleanup());

describe("ResidentPresenceControl", () => {
  // Regression guard for Base UI error #31: DropdownMenuLabel (a base-ui
  // "group part") must sit inside a DropdownMenuGroup, or opening the menu
  // throws at runtime (dev tolerates it; the production build crashed the page).
  it("opens the presence menu and renders all three options without crashing", async () => {
    const user = userEvent.setup();
    render(
      <ResidentPresenceControl
        residentId="00000000-0000-0000-0000-000000000001"
        status="active"
      />,
    );

    const trigger = screen.getByRole("button", { name: /update presence/i });
    await user.click(trigger);

    // These render only inside the opened menu — reaching them proves the
    // GroupLabel rendered inside its Group (no #31 throw).
    expect(await screen.findByText("Update presence")).toBeInTheDocument();
    expect(screen.getByText("Bed Hold — Hospital")).toBeInTheDocument();
    expect(screen.getByText("On leave / vacation")).toBeInTheDocument();
  });

  it("asks when a hospital return happened and saves that time, not the save time (COL-750)", async () => {
    const user = userEvent.setup();
    const yesterday = addFacilityCalendarDays(todayFacilityDateIso(), -1);
    render(<ResidentPresenceControl residentId="res-1" status="hospital" />);
    await user.click(screen.getByRole("button", { name: /update presence/i }));
    await user.click(await screen.findByText("In-house"));

    // Choosing writes nothing until "when" is answered.
    const dialog = await screen.findByRole("dialog");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Date it happened")).toHaveValue("");
    expect(within(dialog).getByLabelText("Time (Eastern)")).toHaveValue("");

    await user.type(within(dialog).getByLabelText("Date it happened"), yesterday);
    await user.type(within(dialog).getByLabelText("Time (Eastern)"), "15:10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const patch = mocks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("active");
    expect(typeof patch.status_effective_at).toBe("string");
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(patch.status_effective_at as string))).toBe(yesterday);
  });

  it("records just now when both fields are left blank", async () => {
    const user = userEvent.setup();
    render(<ResidentPresenceControl residentId="res-1" status="active" />);
    await user.click(screen.getByRole("button", { name: /update presence/i }));
    await user.click(await screen.findByText("On leave / vacation"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const patch = mocks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("loa");
    expect(patch).not.toHaveProperty("status_effective_at");
  });

  it("keeps the dialog open with the database's refusal in its own words", async () => {
    const user = userEvent.setup();
    const message = "A resident movement cannot be dated in the future. Enter when it actually happened.";
    mocks.eq.mockResolvedValueOnce({ error: { code: "22023", message } });
    render(<ResidentPresenceControl residentId="res-1" status="active" />);
    await user.click(screen.getByRole("button", { name: /update presence/i }));
    await user.click(await screen.findByText("On leave / vacation"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
