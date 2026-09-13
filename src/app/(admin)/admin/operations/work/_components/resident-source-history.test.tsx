import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResidentSourceHistory } from "./resident-source-history";
const id = "00000000-0000-0000-0000-000000000001";
const props = { taskId: id, actorId: id, facilityId: id, timezone: "America/New_York" };
const reference = { reference_id: id, family: "form_1823", source_id: id, source_version: "a".repeat(64), period: { start_date: "2026-09-12", end_date: "2026-09-13" }, linked_at: "2026-09-13T12:00:00Z", current_state: "changed", requires_review: true, checks: [] };
const history = (ref = reference) => ({ task_id: id, reviews: [{ receipt_id: id, recorded_at: "2026-09-13T12:00:00Z", recorder_id: id, references: [ref] }] });
const fetchMock = vi.fn();
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("separates original receipt and changed source without exposing unavailable source metadata", async () => {
  fetchMock.mockResolvedValue(response(history({ ...reference, current_state: "unavailable", source_id: null, family: null, source_version: null, period: null } as unknown as typeof reference)));
  render(<ResidentSourceHistory {...props} />); await userEvent.click(screen.getByText("Versioned source review history"));
  await screen.findByText(/Current source eligibility\/version: unavailable/); expect(screen.getByText(/Original review:/)).toBeVisible(); expect(screen.queryByText(/aaaaaaaaaaaa/)).toBeNull(); expect(screen.getByText(/Source details unavailable under current access/)).toBeVisible();
});
it("retries exact recheck after a lost reply, then displays returned current history", async () => {
  fetchMock.mockResolvedValueOnce(response(history())).mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(response(history({ ...reference, current_state: "current", requires_review: false })));
  render(<ResidentSourceHistory {...props} />); await userEvent.click(screen.getByText("Versioned source review history")); await userEvent.click(await screen.findByRole("button", { name: "Recheck source version" }));
  await screen.findByText(/Recheck result unknown/); await userEvent.click(screen.getByRole("button", { name: "Retry same recheck" })); await screen.findByText(/Current source eligibility\/version: current/);
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
});
it("aborts old history reads on actor change", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {})); const { rerender } = render(<ResidentSourceHistory {...props} />); await userEvent.click(screen.getByText("Versioned source review history")); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const signal = fetchMock.mock.calls[0][1].signal; rerender(<ResidentSourceHistory {...props} actorId="other" />); expect(signal.aborted).toBe(true); expect(screen.queryByText(/Original review receipts are historical/)).toBeNull();
});

it("retains authorized original provenance when current source qualification fails", async () => {
  fetchMock.mockResolvedValue(response(history({ ...reference, current_state: "unavailable" })));
  render(<ResidentSourceHistory {...props} />); await userEvent.click(screen.getByText("Versioned source review history"));
  await screen.findByText(/Version aaaaaaaaaaaa/); expect(screen.getByText(/Review required/)).toBeVisible(); expect(screen.queryByText(/Source details unavailable under current access/)).toBeNull();
});
it("clears earlier citations when history refresh fails", async () => {
  fetchMock.mockResolvedValueOnce(response(history())).mockRejectedValueOnce(new Error("revoked"));
  render(<ResidentSourceHistory {...props} />); await userEvent.click(screen.getByText("Versioned source review history")); await screen.findByText(/Version aaaaaaaaaaaa/);
  await userEvent.click(screen.getByRole("button", { name: "Refresh source history" })); await screen.findByText(/Source review history unavailable/); expect(screen.queryByText(/Version aaaaaaaaaaaa/)).toBeNull();
});
