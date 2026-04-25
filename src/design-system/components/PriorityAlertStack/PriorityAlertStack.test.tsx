import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PriorityAlertStack, type AlertItem } from "./PriorityAlertStack";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

function buildAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: "a1",
    severity: "high",
    title: "Fall with injury",
    facilityId: "fac-1",
    organizationId: "org-1",
    facilityName: "Oakridge ALF",
    body: "Resident fall with suspected fracture — clinical review open.",
    openedAt: new Date("2026-04-24T15:57:00-04:00").toISOString(),
    status: "new",
    detailsHref: "/admin/incidents/a1",
    ...overrides,
  };
}

describe("<PriorityAlertStack />", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    ) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders empty copy when no items", () => {
    render(<PriorityAlertStack items={[]} now={FIXED_NOW} />);
    expect(screen.getByText(/no priority alerts/i)).toBeInTheDocument();
  });

  it("renders one high-severity alert with severity, status, and facility", () => {
    render(
      <PriorityAlertStack items={[buildAlert()]} now={FIXED_NOW} />,
    );
    const item = screen.getByText(/fall with injury/i).closest("li")!;
    expect(item).toHaveAttribute("data-severity", "high");
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText(/oakridge alf/i)).toBeInTheDocument();
    expect(screen.getByText(/3m ago/i)).toBeInTheDocument();
  });

  it("renders high, medium, low severities", () => {
    render(
      <PriorityAlertStack
        items={[
          buildAlert({ id: "h", severity: "high", title: "High" }),
          buildAlert({ id: "m", severity: "medium", title: "Medium", status: "action" }),
          buildAlert({ id: "l", severity: "low", title: "Low", status: "review" }),
        ]}
        now={FIXED_NOW}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
  });

  it("optimistically removes an alert on ACK and posts to endpoint", async () => {
    const user = userEvent.setup();
    render(
      <PriorityAlertStack items={[buildAlert()]} now={FIXED_NOW} />,
    );

    const ackBtn = screen.getByRole("button", { name: /acknowledge alert: fall with injury/i });
    await user.click(ackBtn);

    await waitFor(() => {
      expect(screen.queryByText(/fall with injury/i)).toBeNull();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v2/alerts/a1/ack",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"facilityId":"fac-1"'),
      }),
    );
  });

  it("rolls back and shows error alert when ACK endpoint fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ) as typeof globalThis.fetch;

    const user = userEvent.setup();
    render(<PriorityAlertStack items={[buildAlert()]} now={FIXED_NOW} />);

    await user.click(
      screen.getByRole("button", { name: /acknowledge alert: fall with injury/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not acknowledge/i);
    });
    expect(screen.getByText(/fall with injury/i)).toBeInTheDocument();
  });

  it("calls custom onAck handler when provided (no fetch)", async () => {
    const onAck = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <PriorityAlertStack items={[buildAlert()]} now={FIXED_NOW} onAck={onAck} />,
    );
    await user.click(
      screen.getByRole("button", { name: /acknowledge alert/i }),
    );
    await waitFor(() => expect(onAck).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
