import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_IDLE_RESET_MS } from "@/lib/kiosk/contract";
import { createMemoryKioskStore } from "@/lib/timeclock/kiosk-store";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskHome } from "./KioskHome";
import { KioskShell } from "./KioskShell";
import { TEST_DEVICE, TEST_NOW, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

beforeEach(() => {
  navigation.replace.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("KioskShell", () => {
  it("renders the same first HTML whatever the clock says, so hydration cannot mismatch (COL-659)", () => {
    const store = createMemoryKioskStore({ device: TEST_DEVICE });
    const html = (at: string) =>
      renderToString(
        <KioskShell store={store} now={() => new Date(at)}>
          <KioskHome />
        </KioskShell>,
      );
    expect(html("2026-10-01T10:58:00.000Z")).toBe(html("2026-10-01T15:40:00.000Z"));
  });

  it("sends a tablet with no device token to setup", async () => {
    render(
      <KioskShell store={createMemoryKioskStore({ device: null })} now={TEST_NOW} online>
        <KioskHome />
      </KioskShell>,
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/kiosk/setup"));
    expect(screen.queryByText("Welcome. Tap who you are.")).toBeNull();
  });

  it("returns any screen but home to home after 30 seconds without input, and input restarts the wait", async () => {
    vi.useFakeTimers();
    renderInKiosk(<input aria-label="Your name" />, { pathname: "/kiosk/sign-in/visitor" });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(KIOSK_IDLE_RESET_MS - 1000);
    });
    fireEvent.input(screen.getByLabelText("Your name"), { target: { value: "C" } });
    await act(async () => {
      vi.advanceTimersByTime(KIOSK_IDLE_RESET_MS - 1000);
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(navigation.replace).toHaveBeenCalledWith("/kiosk");
  });

  it("never idles away from home itself", async () => {
    vi.useFakeTimers();
    renderInKiosk(<KioskHome />, { pathname: "/kiosk" });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(KIOSK_IDLE_RESET_MS * 3);
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("KioskHome", () => {
  it("shows the facility, the Staff card, four entries and Leaving, and no resident", async () => {
    renderInKiosk(<KioskHome />, { pathname: "/kiosk" });
    expect(await screen.findByRole("heading", { level: 1, name: "Synthetic facility 0001" })).toBeInTheDocument();
    expect(screen.getByText("Circle of Life")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("kiosk-clock")).toHaveTextContent("6:58 AM"));
    expect(screen.getByText("Thursday, October 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Staff/ })).toHaveAttribute("href", "/kiosk/staff");
    expect(screen.getByRole("link", { name: /Visiting a resident/ })).toHaveAttribute("href", "/kiosk/sign-in/visitor");
    expect(screen.getByRole("link", { name: /Healthcare provider/ })).toHaveAttribute("href", "/kiosk/sign-in/provider");
    expect(screen.getByRole("link", { name: /Vendor or contractor/ })).toHaveAttribute("href", "/kiosk/sign-in/vendor");
    expect(screen.getByRole("link", { name: /Inspector or official/ })).toHaveAttribute("href", "/kiosk/sign-in/inspector");
    expect(screen.getByRole("link", { name: "Leaving? Sign out" })).toHaveAttribute("href", "/kiosk/leaving");
  });
});

describe("ConfirmPanel", () => {
  it("announces itself and returns home after exactly five seconds", async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<ConfirmPanel title="You're signed in." body="Signed in at 10:12 AM." onDone={onDone} />);
    expect(screen.getByRole("status")).toHaveTextContent("You're signed in.");
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
