import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VisitorLogClient } from "./VisitorLogClient";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    visitor_name: "Test Visitor One",
    visitor_phone: null,
    visitor_type: "family_friend",
    visiting_type: "resident",
    visiting_resident_id: "r1",
    visiting_resident_name: "Test Resident A",
    signed_in_at: "2026-06-10T18:00:00Z",
    signed_in_by_name: "Review clerk",
    signed_out_at: null,
    signed_out_by_name: null,
    sign_out_method: null,
    voided_at: null,
    void_reason: null,
    left_open: false,
    ...overrides,
  };
}

const RESIDENTS = [
  { id: "r1", firstName: "Test", lastName: "ResidentA" },
  { id: "r2", firstName: "Test", lastName: "ResidentB" },
];

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.confirm.mockReset();
  mocks.rpc.mockResolvedValue({ data: [dbRow()], error: null });
  vi.stubGlobal("confirm", mocks.confirm);
  mocks.confirm.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLog(onSignIn = vi.fn().mockResolvedValue(undefined)) {
  render(
    <VisitorLogClient
      organizationId="org-1"
      facilityId="fac-1"
      residents={RESIDENTS}
      onSignIn={onSignIn}
    />,
  );
  return onSignIn;
}

describe("in the building now", () => {
  it("counts who is open and shows how long they have been here", async () => {
    renderLog();
    expect(await screen.findByText("In the building now (1)")).toBeTruthy();
  });

  it("shows a left open entry as neutral text rather than closing it", async () => {
    mocks.rpc.mockResolvedValue({
      data: [dbRow({ left_open: true, signed_in_at: "2026-06-09T02:00:00Z" })],
      error: null,
    });
    renderLog();
    expect(await screen.findByText(/Still signed in from/)).toBeTruthy();
    // Nothing was signed out on the way past.
    expect(mocks.rpc).not.toHaveBeenCalledWith("visitor_sign_out", expect.anything());
  });
});

describe("sign in", () => {
  it("signs a visitor in against a resident and clears the form", async () => {
    const user = userEvent.setup();
    const onSignIn = renderLog();
    await screen.findByText("In the building now (1)");
    await user.type(screen.getByLabelText("Visitor name"), "Test Visitor Two");
    await user.selectOptions(screen.getByLabelText("Resident"), "r2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Test Visitor Two", residentId: "r2", visitingType: "resident" }),
      );
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Visitor name") as HTMLInputElement).value).toBe("");
    });
  });

  it("signs a visitor in for staff or the facility without naming a resident", async () => {
    const user = userEvent.setup();
    const onSignIn = renderLog();
    await screen.findByText("In the building now (1)");
    await user.type(screen.getByLabelText("Visitor name"), "Test Visitor Three");
    await user.click(screen.getByRole("radio", { name: "Facility" }));
    expect(screen.queryByLabelText("Resident")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledWith(
        expect.objectContaining({ visitingType: "facility", residentId: "" }),
      );
    });
  });

  it("refuses to submit without a name and says why", async () => {
    const user = userEvent.setup();
    const onSignIn = renderLog();
    await screen.findByText("In the building now (1)");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter the visitor's name.")).toBeTruthy();
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Visitor name").getAttribute("aria-invalid")).toBe("true");
  });

  it("only offers residents who hold a bed in this building", async () => {
    renderLog();
    await screen.findByText("In the building now (1)");
    const options = Array.from(
      (screen.getByLabelText("Resident") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["", "r1", "r2"]);
  });
});

describe("sign out", () => {
  it("calls the function rather than updating the row", async () => {
    const user = userEvent.setup();
    renderLog();
    await screen.findByText("In the building now (1)");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visitor_sign_out", { p_entry_id: "v1" });
    });
  });

  it("confirms the count before signing everyone out", async () => {
    const user = userEvent.setup();
    renderLog();
    await screen.findByText("In the building now (1)");
    mocks.rpc.mockResolvedValueOnce({ data: 1, error: null });
    await user.click(screen.getByRole("button", { name: "Sign out everyone" }));
    expect(mocks.confirm).toHaveBeenCalledWith("Sign out the 1 visitor still in the building?");
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visitor_sign_out_all_open", { p_facility_id: "fac-1" });
    });
  });

  it("does nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    mocks.confirm.mockReturnValue(false);
    renderLog();
    await screen.findByText("In the building now (1)");
    await user.click(screen.getByRole("button", { name: "Sign out everyone" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("visitor_sign_out_all_open", expect.anything());
  });
});

describe("void", () => {
  it("needs a coded reason and never deletes", async () => {
    const user = userEvent.setup();
    renderLog();
    await screen.findByText("In the building now (1)");
    await user.click(screen.getByRole("button", { name: "Void" }));
    await user.selectOptions(screen.getByLabelText("Why is this entry wrong"), "duplicate");
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visitor_void", {
        p_entry_id: "v1",
        p_reason: "duplicate",
      });
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("visitor_delete", expect.anything());
  });

  it("keeps a voided entry visible in the third tier", async () => {
    const user = userEvent.setup();
    mocks.rpc.mockResolvedValue({
      data: [dbRow({ voided_at: "2026-06-10T19:00:00Z", void_reason: "entered_in_error" })],
      error: null,
    });
    renderLog();
    await user.click(await screen.findByRole("button", { name: "Voided entries (1)" }));
    expect(await screen.findByText(/voided as Entered in error/)).toBeTruthy();
  });
});

describe("no facility", () => {
  it("asks for one instead of showing an empty building", () => {
    render(
      <VisitorLogClient
        organizationId="org-1"
        facilityId={null}
        residents={RESIDENTS}
        onSignIn={vi.fn()}
      />,
    );
    expect(screen.getByText("Choose a facility to open its visitor log.")).toBeTruthy();
  });
});
