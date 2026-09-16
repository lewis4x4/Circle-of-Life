import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminReferralsNewPage from "@/app/(admin)/admin/referrals/new/page";
import { useFacilityStore } from "@/hooks/useFacilityStore";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_FACILITY_ID = "33333333-3333-4333-8333-333333333333";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const captureMock = vi.hoisted(() => vi.fn());
const commandMock = vi.hoisted(() => vi.fn());
const createSourceMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
const sourcesMock = vi.hoisted(() => ({
  rows: [
    { id: "src-hospital", name: "Synthetic General Hospital", source_type: "hospital" },
    { id: "src-family", name: "Family referral", source_type: "family" },
  ] as Array<{ id: string; name: string; source_type: string }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/admin/referrals/new",
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("../referrals-hub-nav", () => ({
  ReferralsHubNav: () => <div data-testid="referrals-hub-nav" />,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "facilities") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({ data: { timezone: "America/New_York" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "referral_sources") {
        return {
          select: () => ({
            is: () => ({
              eq: () => ({
                or: () => ({
                  order: async () => ({ data: sourcesMock.rows, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/referrals/referral-authority", () => ({
  captureReferralEpisode: captureMock,
  runReferralEpisodeCommand: commandMock,
  createAuthorizedReferralSource: createSourceMock,
}));

function setStore(selectedFacilityId: string | null) {
  useFacilityStore.setState({
    selectedFacilityId,
    selectedReportingPeriod: null,
    availableFacilities: [
      { id: FACILITY_ID, name: "Synthetic Homewood Lodge" },
      { id: OTHER_FACILITY_ID, name: "Synthetic Oakridge" },
    ],
    facilitiesFetchedAt: Date.now(),
    facilitiesCacheUserId: "user-1",
  });
}

async function renderPage() {
  render(<AdminReferralsNewPage />);
  await screen.findByRole("heading", { level: 1, name: "New referral lead" });
  await waitFor(() => expect(screen.getByRole("combobox", { name: /Referral source/ })).not.toBeDisabled());
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Phone and Email are both a text field and a preference radio; address the field by role. */
function typeField(name: "Phone" | "Email", value: string) {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

/** Radix Select: open with the keyboard, then choose the option by its text. */
async function chooseSelectOption(trigger: HTMLElement, optionName: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.keyDown(option, { key: "Enter" });
}

async function fillThirdPartyInquiry() {
  type(/^First name/, "Avery");
  type(/^Last name/, "Resident");
  type(/Contact first name/, "Jordan");
  type(/Contact last name/, "Caller");
  await chooseSelectOption(screen.getByRole("combobox", { name: /Relationship to the prospective resident/ }), "Child");
  typeField("Phone", "5551234567");
  fireEvent.blur(screen.getByRole("textbox", { name: "Phone" }));
  await chooseSelectOption(screen.getByRole("combobox", { name: /Referral source/ }), "Synthetic General Hospital");
}

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.refresh.mockReset();
  captureMock.mockReset();
  captureMock.mockResolvedValue({
    episode_id: "lead-1",
    episode_revision: "a".repeat(64),
    status: "new",
    work_state: "unassigned",
    event_id: "evt-1",
    event_kind: "captured",
    replayed: false,
  });
  commandMock.mockReset();
  commandMock.mockResolvedValue({
    episode_id: "lead-1",
    episode_revision: "b".repeat(64),
    status: "new",
    work_state: "unassigned",
    event_id: "evt-2",
    event_kind: "contact_added",
    replayed: false,
  });
  createSourceMock.mockReset();
  toastMock.mockReset();
  toastMock.success.mockReset();
  setStore(FACILITY_ID);
  // happy-dom has no confirm(); the page uses it before discarding entries.
  window.confirm = vi.fn(() => true);
});

describe("New referral lead — people and roles", () => {
  it("groups the prospective resident, the primary contact and the referral details", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Prospective resident" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Primary contact" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Referral details" })).toBeInTheDocument();
    expect(screen.getByLabelText("The prospective resident is the primary contact")).not.toBeChecked();
    expect(screen.getByLabelText(/Relationship to the prospective resident/)).toBeInTheDocument();
    expect(screen.getByLabelText("No preference recorded")).toBeChecked();
    expect(screen.getByText("Clinical information is entered later by authorized staff.")).toBeInTheDocument();
    expect(screen.queryByText(/approved clinical access tier/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage sources/ })).toHaveAttribute("href", "/admin/referrals/sources");
    expect(screen.getByText("Saving to")).toBeInTheDocument();
    expect(screen.getByText("Synthetic Homewood Lodge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save lead" })).toBeEnabled();
  });

  it("saves a third-party contact as a linked primary contact, not as the resident's own details", async () => {
    await renderPage();
    await fillThirdPartyInquiry();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/admin/referrals/lead-1"));
    expect(captureMock).toHaveBeenCalledTimes(1);
    const captureInput = captureMock.mock.calls[0][1];
    expect(captureInput).toMatchObject({
      facilityId: FACILITY_ID,
      firstName: "Avery",
      lastName: "Resident",
      phone: null,
      email: null,
      preferredContact: "either",
      referralSourceId: "src-hospital",
      receipt: { precision: "date" },
    });
    expect(captureInput.requestKey).toMatch(/^inquiry:/);
    expect(commandMock).toHaveBeenCalledTimes(1);
    expect(commandMock.mock.calls[0][1]).toMatchObject({
      episodeId: "lead-1",
      expectedRevision: "a".repeat(64),
      command: {
        kind: "contact_add",
        first_name: "Jordan",
        last_name: "Caller",
        relationship: "Child",
        phone: "(555) 123-4567",
        email: null,
        is_primary: true,
      },
    });
    expect(toastMock).toHaveBeenCalledWith("Lead saved.", expect.anything());
  });

  it("puts the phone on the lead and records no contact when the resident is the contact", async () => {
    await renderPage();
    type(/^First name/, "Avery");
    type(/^Last name/, "Resident");
    fireEvent.click(screen.getByLabelText("The prospective resident is the primary contact"));
    expect(screen.queryByLabelText(/Contact first name/)).not.toBeInTheDocument();
    typeField("Email", "avery@example.com");
    fireEvent.click(screen.getByRole("radio", { name: "Email" }));
    await chooseSelectOption(screen.getByRole("combobox", { name: /Referral source/ }), "Family referral");

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/admin/referrals/lead-1"));
    expect(captureMock.mock.calls[0][1]).toMatchObject({
      phone: null,
      email: "avery@example.com",
      preferredContact: "email",
      referralSourceId: "src-family",
    });
    expect(commandMock).not.toHaveBeenCalled();
  });
});

describe("New referral lead — validation", () => {
  it("reveals every problem on an attempted save and moves focus to the first one", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    expect(await screen.findByText(/things to fix before saving/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/)).toHaveFocus();
    expect(screen.getByLabelText(/^First name/)).toHaveAccessibleDescription("Enter the prospective resident's first name.");
    expect(screen.getAllByText("Provide a phone number or an email address.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Choose a referral source, or mark it as not yet known.").length).toBeGreaterThanOrEqual(1);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("rejects a channel preference without that channel and an invalid email", async () => {
    await renderPage();
    await fillThirdPartyInquiry();
    fireEvent.click(screen.getByRole("radio", { name: "Email" }));

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));
    expect((await screen.findAllByText("An email preference needs an email address.")).length).toBeGreaterThanOrEqual(1);
    expect(captureMock).not.toHaveBeenCalled();

    typeField("Email", "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));
    expect((await screen.findAllByText("Enter a valid email address.")).length).toBeGreaterThanOrEqual(1);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("accepts an unconfirmed source and an unknown inquiry date without guessing", async () => {
    await renderPage();
    type(/^First name/, "Avery");
    type(/^Last name/, "Resident");
    fireEvent.click(screen.getByLabelText("The prospective resident is the primary contact"));
    typeField("Phone", "5551234567");
    await chooseSelectOption(screen.getByRole("combobox", { name: /Referral source/ }), "Source not yet known");
    fireEvent.click(screen.getByLabelText("Date not known"));

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    await waitFor(() => expect(captureMock).toHaveBeenCalledTimes(1));
    expect(captureMock.mock.calls[0][1]).toMatchObject({ referralSourceId: null, receipt: { precision: "unknown" } });
  });
});

describe("New referral lead — saving, retries and recovery", () => {
  it("ignores a double-click while a save is in flight", async () => {
    let resolveCapture!: (value: unknown) => void;
    captureMock.mockImplementationOnce(() => new Promise((resolve) => { resolveCapture = resolve; }));
    await renderPage();
    await fillThirdPartyInquiry();

    const save = screen.getByRole("button", { name: "Save lead" });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    expect(captureMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCapture({ episode_id: "lead-1", episode_revision: "a".repeat(64), replayed: false });
    });
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledTimes(1));
  });

  it("keeps the entries and reuses the same request key when the lead save fails", async () => {
    captureMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderPage();
    await fillThirdPartyInquiry();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    expect(await screen.findByText(/could not be reached\. Your entries are kept/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/)).toHaveValue("Avery");
    expect(screen.getByLabelText(/Contact first name/)).toHaveValue("Jordan");
    expect(routerMock.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/admin/referrals/lead-1"));
    expect(captureMock).toHaveBeenCalledTimes(2);
    expect(captureMock.mock.calls[1][1].requestKey).toBe(captureMock.mock.calls[0][1].requestKey);
  });

  it("says the lead is saved but the contact is not, and retries only the contact", async () => {
    commandMock.mockRejectedValueOnce(new Error("Referral write authority required"));
    await renderPage();
    await fillThirdPartyInquiry();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    expect(await screen.findByText("You do not have referral write access for this facility.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save contact" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open lead without contact" })).toHaveAttribute("href", "/admin/referrals/lead-1");
    expect(screen.getByLabelText(/^First name/)).toBeDisabled();
    expect(screen.getByLabelText(/Contact first name/)).toBeEnabled();
    expect(routerMock.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/admin/referrals/lead-1"));
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(commandMock).toHaveBeenCalledTimes(2);
    expect(commandMock.mock.calls[1][1].requestKey).toBe(commandMock.mock.calls[0][1].requestKey);
  });

  it("translates a write-authority refusal on the lead itself", async () => {
    captureMock.mockRejectedValueOnce(new Error("Referral write authority required"));
    await renderPage();
    await fillThirdPartyInquiry();

    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    expect(await screen.findByText("You do not have referral write access for this facility.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save lead" })).toBeEnabled();
  });
});

describe("New referral lead — leaving with unsaved work", () => {
  it("keeps entries when the saving facility changes and re-checks the source", async () => {
    await renderPage();
    await fillThirdPartyInquiry();

    act(() => {
      useFacilityStore.getState().setSelectedFacility(OTHER_FACILITY_ID);
    });

    await screen.findByText("Synthetic Oakridge");
    expect(screen.getByLabelText(/^First name/)).toHaveValue("Avery");
    expect(screen.getByLabelText(/Contact first name/)).toHaveValue("Jordan");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(555) 123-4567");
  });

  it("warns before unload while there is unsaved work, and not on a clean form", async () => {
    await renderPage();

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    type(/^First name/, "Avery");
    await waitFor(() => expect(screen.getByText("Your changes have not been saved.")).toBeInTheDocument());
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("asks before cancelling with unsaved entries", async () => {
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy;
    await renderPage();
    type(/^First name/, "Avery");

    const cancel = screen.getByRole("link", { name: "Cancel" });
    const click = fireEvent.click(cancel);

    expect(confirmSpy).toHaveBeenCalledWith("Leave this page? The details you entered will not be saved.");
    expect(click).toBe(false);
  });

  it("shows the no-facility state without losing the page", async () => {
    setStore(null);
    render(<AdminReferralsNewPage />);

    expect(await screen.findByText(/Choose a saving facility/)).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { level: 1 })).getByText("New referral lead")).toBeInTheDocument();
  });
});
