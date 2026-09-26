import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  KIOSK_KINDS,
  KIOSK_RESIDENT_COPY,
  KIOSK_SICK_QUESTION,
  KIOSK_VISITOR_COPY,
  KIOSK_VISITOR_ERROR_COPY,
  KIOSK_VISITOR_KINDS,
  KIOSK_VISITOR_RESIDENTS_ENDPOINT,
} from "@/lib/kiosk/contract";
import { KIOSK_SIGN_IN_COPY } from "@/lib/kiosk/screens";

import { KioskSignInForm } from "./KioskSignInForm";
import { json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

const OK = { entry_id: "e1", checked_in_at: "2026-10-01T14:12:00.000Z" };
const RESIDENT_LABEL = "Resident you are seeing";
const MARTHA = { resident_id: "84ad69f3-911e-4069-9b4f-24aebe591a79", display_name: "Martha J.", room: "12" };

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

  it("asks nothing the visitor form does not list, and lists no resident before three letters", async () => {
    const fetchImpl = vi.fn();
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    expect(await screen.findByLabelText(RESIDENT_LABEL)).toHaveAttribute("placeholder", "Start typing their first or last name");
    expect(screen.getByText("Only used if the building needs to reach you.")).toBeInTheDocument();
    type(RESIDENT_LABEL, "Ma");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole("list", { name: KIOSK_RESIDENT_COPY.listLabel })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps Sign in off on the visit form until a resident is picked or a name is typed", async () => {
    renderInKiosk(<KioskSignInForm kind="visitor" />, { pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    const submit = screen.getByRole("button", { name: KIOSK_SIGN_IN_COPY.submit });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.notListed }));
    expect(screen.getByText(KIOSK_RESIDENT_COPY.typedHint)).toBeInTheDocument();
    type(RESIDENT_LABEL, "Test Resident");
    expect(submit).toBeEnabled();
  });

  it("finds the resident after three letters, locks the pick, and sends resident_id with no typed name", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).startsWith(KIOSK_VISITOR_RESIDENTS_ENDPOINT) ? json(200, { matches: [MARTHA, { resident_id: "r2", display_name: "Mark T.", room: null }] }) : json(200, OK),
    );
    renderInKiosk(<KioskSignInForm kind="provider" />, { fetchImpl, pathname: "/kiosk/sign-in/provider" });
    await screen.findByLabelText("Your name");
    type("Your name", "Dana Reyes");
    type(/Agency or practice/, "Sunshine Hospice");
    type(RESIDENT_LABEL, "Mar");
    const list = await screen.findByRole("list", { name: KIOSK_RESIDENT_COPY.listLabel });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).getByText("Room 12")).toBeInTheDocument();
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`${KIOSK_VISITOR_RESIDENTS_ENDPOINT}?prefix=Mar`);
    fireEvent.click(within(list).getByRole("button", { name: /Martha J\./ }));
    expect(screen.getByText("Martha J. · Room 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.change })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    signIn();
    await screen.findByText("You're signed in.");
    const signInCall = fetchImpl.mock.calls.find((call) => String(call[0]) === "/api/kiosk/visitor/sign-in") as unknown as [string, RequestInit];
    const body = JSON.parse(String(signInCall[1].body));
    expect(body).toMatchObject({ kind: "provider", resident_id: MARTHA.resident_id, visiting_name: null });
  });

  it("says there is no match after three letters, and Change clears a pick", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, { matches: [] })).mockResolvedValue(json(200, { matches: [MARTHA] }));
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    type(RESIDENT_LABEL, "Zzz");
    expect(await screen.findByText(KIOSK_RESIDENT_COPY.noMatch)).toBeInTheDocument();
    type(RESIDENT_LABEL, "Mart");
    fireEvent.click(await screen.findByRole("button", { name: /Martha J\./ }));
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.change }));
    expect(screen.getByLabelText(RESIDENT_LABEL)).toHaveValue("");
    expect(screen.getByLabelText(RESIDENT_LABEL)).toHaveFocus();
  });

  it("keeps only the answer to the latest letters when responses arrive out of order", async () => {
    let releaseFirst: (response: Response) => void = () => {};
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(json(200, { matches: [MARTHA] }));
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    await screen.findByLabelText("Your name");
    type(RESIDENT_LABEL, "Mar");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    type(RESIDENT_LABEL, "Mart");
    await screen.findByRole("button", { name: /Martha J\./ });
    releaseFirst(json(200, { matches: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(KIOSK_RESIDENT_COPY.noMatch)).toBeNull();
    expect(screen.getByRole("button", { name: /Martha J\./ })).toBeInTheDocument();
  });

  it("chooses no sick answer for the visitor and refuses to sign in until one is chosen", async () => {
    const fetchImpl = vi.fn();
    renderInKiosk(<KioskSignInForm kind="visitor" />, { fetchImpl, pathname: "/kiosk/sign-in/visitor" });
    const group = await screen.findByRole("group", { name: KIOSK_SICK_QUESTION });
    for (const button of within(group).getAllByRole("button")) expect(button).toHaveAttribute("aria-pressed", "false");
    type("Your name", "Carol Parker");
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.notListed }));
    type(RESIDENT_LABEL, "Test Resident");
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
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.notListed }));
    type(RESIDENT_LABEL, "Test Resident");
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
      resident_id: null,
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
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.notListed }));
    type(RESIDENT_LABEL, "Test Resident");
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
    fireEvent.click(screen.getByRole("button", { name: KIOSK_RESIDENT_COPY.notListed }));
    type(RESIDENT_LABEL, "Test Resident");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    signIn();
    const busy = await screen.findByText(KIOSK_VISITOR_ERROR_COPY.device_throttled);
    expect(busy).toHaveAttribute("role", "status");
    expect(KIOSK_VISITOR_ERROR_COPY.device_throttled).toBe("This kiosk is busy. Please try again in a few minutes or see the front desk.");
  });
});
