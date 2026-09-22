import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESIDENT_HEADER_ACTION_CLASS,
  ResidentDocumentationActions,
  ResidentLifecycleMenu,
} from "./ResidentHeaderActions";

const mocks = vi.hoisted(() => ({
  role: "facility_admin",
  load: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: mocks.role, loading: false }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from, auth: { getUser: vi.fn() } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/residents/bed-move", async (original) => ({
  ...(await original<typeof import("@/lib/residents/bed-move")>()),
  loadBedMoveSnapshot: mocks.load,
}));

function mountMenu(extra: Record<string, unknown> = {}) {
  render(
    <ResidentLifecycleMenu
      residentId="resident-1"
      residentName="Ada Test"
      facilityId="facility-1"
      currentBedLabel="101-A"
      status="in_house"
      {...extra}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "facility_admin";
  mocks.load.mockResolvedValue({
    facilityName: "Test facility",
    currentBedId: "old",
    currentBedLabel: "Room 101 · Bed A",
    options: [{ id: "free", label: "Room 103 · Bed A", conflict: null }],
  });
});
afterEach(cleanup);

describe("Resident header actions", () => {
  // The header used to mix a 44px button, a 32px button and bare text in one
  // row. One constant is what keeps that from coming back a button at a time.
  it("gives every documentation action the one header action size", () => {
    render(
      <ResidentDocumentationActions
        onLogBehavior={vi.fn()}
        onLogCondition={vi.fn()}
        onGeneralNote={vi.fn()}
      />,
    );
    for (const name of ["Log behavior", "Log condition", "General note"]) {
      expect(screen.getByRole("button", { name })).toHaveClass(
        ...RESIDENT_HEADER_ACTION_CLASS.split(" "),
      );
    }
  });

  it("runs each documentation action from its own button", async () => {
    const user = userEvent.setup();
    const onLogBehavior = vi.fn();
    const onLogCondition = vi.fn();
    const onGeneralNote = vi.fn();
    render(
      <ResidentDocumentationActions
        onLogBehavior={onLogBehavior}
        onLogCondition={onLogCondition}
        onGeneralNote={onGeneralNote}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Log behavior" }));
    await user.click(screen.getByRole("button", { name: "Log condition" }));
    await user.click(screen.getByRole("button", { name: "General note" }));
    expect(onLogBehavior).toHaveBeenCalledOnce();
    expect(onLogCondition).toHaveBeenCalledOnce();
    expect(onGeneralNote).toHaveBeenCalledOnce();
  });

  it("keeps the lifecycle actions out of the header until the menu is opened", async () => {
    const user = userEvent.setup();
    mountMenu();
    expect(screen.queryByText("Change bed…")).not.toBeInTheDocument();
    expect(screen.queryByText("Record discharge…")).not.toBeInTheDocument();
    expect(screen.queryByText("Monitoring Order…")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /More actions for Ada Test/ }));
    expect(await screen.findByText("Change bed…")).toBeInTheDocument();
    expect(screen.getByText("Record discharge…")).toBeInTheDocument();
    expect(screen.getByText("Monitoring Order…")).toBeInTheDocument();
  });

  it("does not offer a bed move to a role that cannot perform one", async () => {
    const user = userEvent.setup();
    mocks.role = "caregiver";
    mountMenu();
    await user.click(screen.getByRole("button", { name: /More actions for Ada Test/ }));
    expect(await screen.findByText("Record discharge…")).toBeInTheDocument();
    expect(screen.queryByText("Change bed…")).not.toBeInTheDocument();
  });

  it("opens the discharge dialog from the menu, outside the menu content", async () => {
    const user = userEvent.setup();
    mountMenu();
    await user.click(screen.getByRole("button", { name: /More actions for Ada Test/ }));
    await user.click(await screen.findByText("Record discharge…"));
    // Radix unmounts menu content on close; a dialog that survives that is a
    // dialog rendered outside it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Record discharge — Ada Test/)).toBeInTheDocument();
  });

  it("still honours the ?changeBed=1 deep link now that the trigger is in a menu", async () => {
    mountMenu({ initialDialog: "bed" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(screen.getByText("Change bed — Ada Test")).toBeInTheDocument();
  });

  it("offers the release-hold action only while the resident is out of the building", async () => {
    const user = userEvent.setup();
    mountMenu();
    await user.click(screen.getByRole("button", { name: /More actions for Ada Test/ }));
    await screen.findByText("Record discharge…");
    expect(screen.queryByText(/Will not return/)).not.toBeInTheDocument();
    cleanup();

    mountMenu({ status: "hospital" });
    await user.click(screen.getByRole("button", { name: /More actions for Ada Test/ }));
    expect(await screen.findByText(/Will not return/)).toBeInTheDocument();
  });
});
