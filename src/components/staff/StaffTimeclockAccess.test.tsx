import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TIMECLOCK_ACCESS_REMOVED } from "@/lib/timeclock/display-copy";

import { StaffTimeclockAccess } from "./StaffTimeclockAccess";

const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const status = (overrides: Record<string, unknown> = {}) => ({
  staff_id: STAFF,
  eligible: true,
  exists: false,
  employee_number: null,
  has_badge: false,
  locked_until: null,
  pin_set_at: null,
  badge_set_at: null,
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("StaffTimeclockAccess", () => {
  it("shows Timeclock access removed for a deactivated person and offers no controls", async () => {
    const fetchImpl = vi.fn(async () => json(200, { status: status({ eligible: false, exists: true, employee_number: "B200" }), badge_secret_configured: true }));
    render(<StaffTimeclockAccess staffId={STAFF} canEdit fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByTestId("timeclock-access-removed")).toHaveTextContent(TIMECLOCK_ACCESS_REMOVED);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("creates a timeclock ID and PIN without asking the manager for a number", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { status: status(), badge_secret_configured: true }))
      .mockResolvedValueOnce(json(200, { status: status({ exists: true, employee_number: "12345678", pin_set_at: "2026-09-16T12:00:00.000Z" }), pin: "482913" }));
    render(<StaffTimeclockAccess staffId={STAFF} canEdit fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate timeclock ID and PIN" }));
    expect(await screen.findByTestId("revealed-pin")).toHaveTextContent("482913");
    expect(screen.getByText("12345678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    const body = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ staff_id: STAFF, action: "create" });
    expect(screen.getByRole("button", { name: "Reset PIN" })).toBeInTheDocument();
  });

  it("registers a badge by scanning into a focused masked input and sends it once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { status: status({ exists: true, employee_number: "A-100" }), badge_secret_configured: true }))
      .mockResolvedValueOnce(json(200, { status: status({ exists: true, employee_number: "A-100", has_badge: true }), pin: null }));
    render(<StaffTimeclockAccess staffId={STAFF} canEdit fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Register badge" }));
    const badgeInput = await screen.findByLabelText("Scan the badge now");
    await waitFor(() => expect(document.activeElement).toBe(badgeInput));
    expect(badgeInput).toHaveAttribute("type", "password");
    fireEvent.change(badgeInput, { target: { value: "0004567" } });
    fireEvent.submit(badgeInput.closest("form")!);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ staff_id: STAFF, action: "set_badge", badge: "0004567" });
    expect(await screen.findByText("Registered")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scan the badge now")).toBeNull();
  });

  it("hides the badge button when the server secret is not configured and shows read-only rows without edit rights", async () => {
    const fetchImpl = vi.fn(async () => json(200, { status: status({ exists: true, employee_number: "A-100" }), badge_secret_configured: false }));
    const { rerender } = render(<StaffTimeclockAccess staffId={STAFF} canEdit fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByRole("button", { name: "Reset PIN" });
    expect(screen.queryByRole("button", { name: "Register badge" })).toBeNull();
    rerender(<StaffTimeclockAccess staffId={STAFF} canEdit={false} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reset PIN" })).toBeNull());
    expect(screen.getByText("A-100")).toBeInTheDocument();
  });
});
