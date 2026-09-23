import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrityCompliancePanel } from "./IntegrityCompliancePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const NO_RESIDENTS_COPY = /residents in occupancy/;
const emptyTotals = { expected: 0, satisfied: 0, unconfigured: 0, absorbed: 0, withTask: 0, onTime: 0, late: 0 };

it("shows only the failure, never the no-residents explanation, when the read fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ error: "Could not load complete observation compliance" }),
    { status: 500 },
  )));
  await act(async () => { render(<IntegrityCompliancePanel facilityId="building-a" />); });
  expect(screen.getByText("Could not load complete observation compliance")).toBeTruthy();
  expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  expect(screen.queryByText(NO_RESIDENTS_COPY)).toBeNull();
});

it("explains an empty range only after a successful read with zero windows", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    from: "2026-09-16", to: "2026-09-22", totals: emptyTotals, byShift: [], byHall: [], byStaff: [],
  }))));
  await act(async () => { render(<IntegrityCompliancePanel facilityId="building-a" />); });
  expect(screen.getByText(NO_RESIDENTS_COPY)).toBeTruthy();
});
