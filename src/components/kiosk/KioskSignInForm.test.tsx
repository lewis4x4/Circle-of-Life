import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_KINDS, KIOSK_SICK_QUESTION, KIOSK_VISITOR_COPY, KIOSK_VISITOR_ERROR_COPY, KIOSK_VISITOR_KINDS } from "@/lib/kiosk/contract";
import { KIOSK_SIGN_IN_COPY } from "@/lib/kiosk/screens";

import { KioskSignInForm } from "./KioskSignInForm";
import { json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

const OK = { entry_id: "e1", checked_in_at: "2026-10-01T14:12:00.000Z" };

beforeEach(() => {
  navigation.replace.mockReset();
});

function signIn() {
  fireEvent.click(screen.getByRole("button", { name: KIOSK_SIGN_IN_COPY.submit }));
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("KioskSignInForm", () => {
  it.each(KIOSK_VISITOR_KINDS)("renders the %s form with its title, subtitle and fields", async (kind) => {
    renderInKiosk(<KioskSignInForm kind={kind} />, { pathname: `/kiosk/sign-in/${kind}` });
    expect(await screen.findByRole("heading", { level: 1, name: KIOSK_KINDS[kind].title })).toBeInTheDocument();
    expect(screen.getByText(KIOSK_KINDS[kind].formSubtitle)).toBeInTheDocument();
    expect(screen.getByText(KIOSK_VISITOR_COPY.visitorLogLine)).toBeInTheDocument();
    const asksSick = KIOSK_KINDS[kind].fields.some((field) => field.name === "symptoms");
    expect(screen.queryByRole("group", { name: KIOSK_SICK_QUESTION }) !== null).toBe(asksSick);
    expect(screen.getByLabelText("Your name")).toBeRequired();
  });

  it("asks nothing the visitor form does not list, and lists no resident", async () => {
    renderInKiosk(<KioskSignInForm kind="visitor" />, { pathname: "/kiosk/sign-in/visitor" });
    expect(await screen.findByLabelText("Who are you visiting?")).toHaveAttribute("placeholder", "Resident's name");
    expect(screen.getByText("Type their name. Staff will match it.")).toBeInTheDocument();
    expect(screen.getByText("Only used if the building needs to reach you.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("chooses no sick answer for the visitor and refuses to sign in until one is chosen", async () => {
    const fetchImpl = vi.fn();
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    const group = await screen.findByRole("group", { name: KIOSK_SICK_QUESTION });
    for (const button of within(group).getAllByRole("button")) expect(button).toHaveAttribute("aria-pressed", "false");
    type("Your name", "Carol Parker");
    type("Who are you visiting?", "Test Resident");
    signIn();
    expect(await screen.findByText("Choose Yes or No.")).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the front desk warning on Yes, in the warning text color", async () => {
    renderInKiosk(<KioskSignInForm kind="visitor" />, { pathname: "/kiosk/sign-in/visitor" });
    const group = await screen.findByRole("group", { name: KIOSK_SICK_QUESTION });
    expect(screen.queryByText(KIOSK_VISITOR_COPY.sickWarning)).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Yes" }));
    expect(within(group).getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
    const warning = screen.getByText(KIOSK_VISITOR_COPY.sickWarning);
    expect(warning.className).toContain("text-destructive");
    fireEvent.click(within(group).getByRole("button", { name: "No" }));
    expect(screen.queryByText(KIOSK_VISITOR_COPY.sickWarning)).toBeNull();
  });

  it("marks the required fields and announces what is missing", async () => {
    const fetchImpl = vi.fn();
    renderInKiosk(<KioskSignInForm kind="provider" />, { fetchImpl, pathname: "/kiosk/sign-in/provider" });
    await screen.findByLabelText("Your name");
    expect(screen.getByText("(required)")).toBeInTheDocument();
    signIn();
    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter agency or practice.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Your name")).toHaveFocus();
    expect(screen.getByText("Check the highlighted answers.")).toHaveAttribute("role", "status");
    // The provider's resident is optional.
    expect(screen.queryByText(/Enter resident/)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("needs a company from a vendor and an agency from an inspector", async () => {
    renderInKiosk(<KioskSignInForm kind="vendor" />, { pathname: "/kiosk/sign-in/vendor" });
    type(await screen.findByLabelText("Your name").then(() => "Your name"), "Carlos Mendez");
    signIn();
    expect(await screen.findByText("Enter company.")).toBeInTheDocument();
  });

  it("signs a visitor in once per form, with the typed resident and the answer, then confirms", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(503, { error: "unavailable" })).mockResolvedValueOnce(json(200, OK));
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    type("Your name", "Carol Parker");
    type("Phone", "904.555.0100");
    type("Who are you visiting?", "Test Resident");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    signIn();
    expect(await screen.findByText(KIOSK_VISITOR_ERROR_COPY.unavailable)).toBeInTheDocument();
    signIn();
    const status = await screen.findByText("You're signed in.");
    expect(status.closest("[role=status]")).toHaveTextContent("Signed in at 10:12 AM.");
    expect(screen.getByText(KIOSK_VISITOR_COPY.signOutReminder.strong).tagName).toBe("B");
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0]).toEqual({
      kind: "visitor",
      name: "Carol Parker",
      phone: "904.555.0100",
      company: null,
      visiting_name: "Test Resident",
      purpose: null,
      symptoms: false,
      client_entry_id: bodies[0].client_entry_id,
    });
    expect(bodies[1].client_entry_id).toBe(bodies[0].client_entry_id);
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-timeclock-device"]).toBe("tok");
  });

  it("shows the server's field errors inline", async () => {
    const fetchImpl = vi.fn(async () => json(400, { error: "invalid_input", fields: { phone: "Enter a phone number with 7 to 20 digits." } }));
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    type("Your name", "Carol Parker");
    type("Who are you visiting?", "Test Resident");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    signIn();
    expect(await screen.findByText("Enter a phone number with 7 to 20 digits.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true"));
  });

  it("says the kiosk is busy when it is throttled, in the status area", async () => {
    const fetchImpl = vi.fn(async () => json(429, { error: "device_throttled" }));
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    type("Your name", "Carol Parker");
    type("Who are you visiting?", "Test Resident");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    signIn();
    const busy = await screen.findByText(KIOSK_VISITOR_ERROR_COPY.device_throttled);
    expect(busy).toHaveAttribute("role", "status");
    expect(KIOSK_VISITOR_ERROR_COPY.device_throttled).toBe("This kiosk is busy. Please try again in a few minutes or see the front desk.");
  });
});
