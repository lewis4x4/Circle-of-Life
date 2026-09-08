import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResidentPresenceControl } from "./ResidentPresenceControl";

const mocks = vi.hoisted(() => ({ status: "active", updateError: null as null | { message: string }, patches: [] as Record<string, unknown>[], filters: [] as [string, unknown][], tables: [] as string[], success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    mocks.tables.push(table);
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return query; },
      is: () => query,
      maybeSingle: async () => ({ data: { status: mocks.status, hold_case_manager_notified_at: "2026-01-01T00:00:00Z" }, error: null }),
      update: (patch: Record<string, unknown>) => { mocks.patches.push(patch); return query; },
      single: async () => ({ data: mocks.updateError ? null : { id: "resident" }, error: mocks.updateError }),
    };
    return query;
  },
}) }));
beforeEach(() => { mocks.status = "active"; mocks.updateError = null; mocks.patches = []; mocks.filters = []; mocks.tables = []; vi.clearAllMocks(); });
afterEach(cleanup);

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
});


describe("presence truth and save confirmation", () => {
  it("entering hold never creates or replaces communication evidence", async () => {
    render(<ResidentPresenceControl residentId="resident" status="active" />);
    await userEvent.click(screen.getByRole("button", { name: /update presence/i }));
    await userEvent.click(screen.getByText("Bed Hold — Hospital"));
    await waitFor(() => expect(mocks.patches).toHaveLength(1));
    expect(mocks.patches[0]).toEqual({ status: "hospital_hold", updated_by: "actor" });
    expect(mocks.filters).toContainEqual(["status", "active"]);
  });

  it("hospital return reports presence separately and leaves document work to the durable follow-up", async () => {
    mocks.status = "hospital_hold";
    const changed = vi.fn();
    render(<ResidentPresenceControl residentId="resident" status="hospital" onChanged={changed} />);
    await userEvent.click(screen.getByRole("button", { name: /update presence/i }));
    await userEvent.click(screen.getByText("In-house"));
    await waitFor(() => expect(changed).toHaveBeenCalledWith("active"));
    expect(mocks.tables).not.toContain("form_1823_records");
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("follow-up remains available"));
  });

  it("cannot resurrect a resident discharged since the page loaded", async () => {
    mocks.status = "discharged";
    render(<ResidentPresenceControl residentId="resident" status="active" />);
    await userEvent.click(screen.getByRole("button", { name: /update presence/i }));
    await userEvent.click(screen.getByText("Bed Hold — Hospital"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.patches).toHaveLength(0);
  });

  it("zero-row or rejected compare-and-save never reports success", async () => {
    mocks.updateError = { message: "No row matched current status" };
    const changed = vi.fn();
    render(<ResidentPresenceControl residentId="resident" status="active" onChanged={changed} />);
    await userEvent.click(screen.getByRole("button", { name: /update presence/i }));
    await userEvent.click(screen.getByText("Bed Hold — Hospital"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(changed).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});


it("does not overwrite another operator's newer in-census presence state", async () => {
  mocks.status = "loa";
  render(<ResidentPresenceControl residentId="resident" status="active" />);
  await userEvent.click(screen.getByRole("button", { name: /update presence/i }));
  await userEvent.click(screen.getByText("Bed Hold — Hospital"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.patches).toHaveLength(0);
});
