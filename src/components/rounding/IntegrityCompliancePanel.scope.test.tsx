import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrityCompliancePanel } from "./IntegrityCompliancePanel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not show the previous building when its slow response arrives last", async () => {
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
  const view = render(<IntegrityCompliancePanel facilityId="building-a" />);
  view.rerender(<IntegrityCompliancePanel facilityId="building-b" />);
  const answer = (satisfied: number) => new Response(JSON.stringify({
    from: "2026-09-01", to: "2026-09-07",
    totals: { expected: 10, satisfied, unconfigured: 0, absorbed: 0, withTask: 10, onTime: satisfied, late: 0 },
    byShift: [], byHall: [], byStaff: [],
  }));
  await act(async () => pending[1](answer(9)));
  expect(screen.getByText("9 of 10 expected windows recorded")).toBeTruthy();
  await act(async () => pending[0](answer(1)));
  expect(screen.getByText("9 of 10 expected windows recorded")).toBeTruthy();
  expect(screen.queryByText("1 of 10 expected windows recorded")).toBeNull();
});
