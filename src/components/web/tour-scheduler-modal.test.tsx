import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TourSchedulerModal } from "./tour-scheduler-modal";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps tour details on server failure, retries idempotently and reports only a received request", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Unavailable" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ received: true }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TourSchedulerModal isOpen onClose={() => {}} defaultFacilityId="homewood" />);
  for (const [label, value] of [["Your Full Name", "Test Family"], ["Mobile Phone", "3865550199"], ["Email Address", "test@example.invalid"], ["Preferred Date", "2026-10-03"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Request Tour & Complimentary Lunch" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Preferred Date")).toHaveValue("2026-10-03");
  expect(screen.queryByText("Tour Request Received")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Request Tour & Complimentary Lunch" }));
  await screen.findByText("Tour Request Received");
  expect(screen.getByText(/No tour is booked yet/)).toBeInTheDocument();
  expect(screen.queryByText(/SMS confirmation/)).toBeNull();
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(first).toMatchObject({ facility: "homewood", tourDate: "2026-10-03", lunchOption: "yes-2" });
  expect(first).toEqual(JSON.parse(fetchMock.mock.calls[1][1].body));
});
