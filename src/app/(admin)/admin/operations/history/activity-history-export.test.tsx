import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { triggerCsvDownload } from "@/lib/csv-export";
import { ActivityHistoryExport } from "./activity-history-export";

vi.mock("@/lib/csv-export", () => ({ triggerCsvDownload: vi.fn() }));
const exportId = "00000000-0000-4000-8000-000000000151";
const selection = { facilityId: "facility", activityId: "activity" };
const snapshot = (total = 1103) => ({ export_id: exportId, manifest: {
  complete: true, generated_at: "2026-09-13T02:00:00.123456Z", total, receipt_total: total + 2,
  evidence_total: total, filters: { facility_id: "facility", activity_id: "activity" },
} });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const csv = () => new Response('kind,total\r\nmanifest,1103\r\n', { headers: { "Content-Type": "text/csv; charset=utf-8" } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});
const start = () => fireEvent.click(screen.getByRole("button", { name: "Download complete CSV" }));

describe("Activity history export", () => {
  it("creates the selected full-history snapshot and downloads only the complete CSV", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(csv());
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByText(/Downloaded complete snapshot: 1103 occurrences/);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      facility_id: "facility", activity_id: "activity", request_id: expect.any(String),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/admin/operations/activity-history/exports/${exportId}/download`, expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
    expect(triggerCsvDownload).toHaveBeenCalledWith(`haven-activity-history-${exportId}.csv`, 'kind,total\r\nmanifest,1103\r\n');
  });
  it("retries a failed later-page download from the same snapshot without saving a partial file", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(json({ error: "later page failed" }, 503)).mockResolvedValueOnce(csv());
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByRole("alert");
    expect(triggerCsvDownload).not.toHaveBeenCalled();
    expect(screen.queryByText(/Downloaded complete snapshot/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry export" }));
    await screen.findByText(/Downloaded complete snapshot/);
    expect(vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
  it("reuses the request ID after uncertain creation and gives a fresh ID for a new snapshot", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Interrupted"))
      .mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(csv())
      .mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(csv());
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry export" }));
    await screen.findByText(/Downloaded complete snapshot/);
    fireEvent.click(screen.getByRole("button", { name: "Export a fresh snapshot" }));
    await waitFor(() => expect(triggerCsvDownload).toHaveBeenCalledTimes(2));
    const requests = vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === "POST").map((call) => JSON.parse(String(call[1]?.body)).request_id);
    expect(requests[0]).toBe(requests[1]);
    expect(requests[2]).not.toBe(requests[1]);
  });
  it.each([401, 403, 404])("denies revoked download (%i) with no finished file", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(json({}, status));
    render(<ActivityHistoryExport {...selection} />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer accessible");
    expect(triggerCsvDownload).not.toHaveBeenCalled();
  });
  it.each([json({}), json({ ...snapshot(), manifest: { ...snapshot().manifest, complete: false } }), json({ ...snapshot(), manifest: { ...snapshot().manifest, filters: { facility_id: "other", activity_id: "activity" } } })])("rejects malformed, partial or wrong-scope manifests", async (response) => {
    vi.mocked(fetch).mockResolvedValueOnce(response);
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByRole("alert");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(triggerCsvDownload).not.toHaveBeenCalled();
  });
  it("does not save login HTML or a missing manifest as a CSV", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot())).mockResolvedValueOnce(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByRole("alert");
    expect(triggerCsvDownload).not.toHaveBeenCalled();
  });
  it("labels complete empty exports distinctly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot(0))).mockResolvedValueOnce(csv());
    render(<ActivityHistoryExport {...selection} />);
    start();
    await screen.findByText(/Confirmed empty history/);
  });
  it("aborts on unmount and ignores an old download that completes after person/scope changes", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(json(snapshot())).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<ActivityHistoryExport {...selection} />);
    start();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(csv()));
    expect(triggerCsvDownload).not.toHaveBeenCalled();
  });
  it("exposes accessible controls and pending status", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const view = render(<ActivityHistoryExport {...selection} />);
    expect((await axe.run(view.container)).violations).toEqual([]);
    start();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("current access");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
