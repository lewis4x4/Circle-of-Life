/**
 * Test-only helpers for the kiosk components. `next/navigation` must be mocked
 * by the test file (see `navigation` below) before these render.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { createMemoryKioskStore, type KioskDevice, type KioskStore } from "@/lib/timeclock/kiosk-store";

import { KioskShell } from "./KioskShell";
import { navigation } from "./kiosk-test-navigation";

export { navigation };

export const TEST_DEVICE: KioskDevice = { token: "tok", facilityId: "f1", facilityName: "Synthetic facility 0001", enrolledAt: "2026-09-16T10:00:00.000Z" };
/** 6:58 AM Eastern. */
export const TEST_NOW = () => new Date("2026-10-01T10:58:00.000Z");


export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function renderInKiosk(
  ui: ReactNode,
  options: { store?: KioskStore; fetchImpl?: unknown; online?: boolean; idleMs?: number; pathname?: string } = {},
) {
  navigation.pathname = options.pathname ?? navigation.pathname;
  const store = options.store ?? createMemoryKioskStore({ device: TEST_DEVICE });
  const fetchImpl = (options.fetchImpl ?? vi.fn()) as typeof fetch;
  const view = render(
    <KioskShell store={store} fetchImpl={fetchImpl} now={TEST_NOW} online={options.online ?? true} idleMs={options.idleMs}>
      {ui}
    </KioskShell>,
  );
  const rerenderWith = (next: { fetchImpl?: unknown; online?: boolean }) =>
    view.rerender(
      <KioskShell store={store} fetchImpl={(next.fetchImpl ?? fetchImpl) as typeof fetch} now={TEST_NOW} online={next.online ?? true} idleMs={options.idleMs}>
        {ui}
      </KioskShell>,
    );
  return { ...view, store, fetchImpl, rerenderWith };
}
