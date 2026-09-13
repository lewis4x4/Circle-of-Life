import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskReminder } from "./task-reminder";
vi.mock("./work-inputs", () => ({ DateTimeInput: ({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) => <label htmlFor={id}>{label}<input id={id} value={value} onChange={event => onChange(event.target.value)} /></label> }));
const id = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const episode = { id, issue_id: null, source_label: "Check equipment", state: "active", phase: "overdue", problem: null, revision, generation: 1, acknowledged_at: null, snoozed_until: null, can_respond: true, suppressed: false, channel: "in_app", delivery_status: "queued", replayed: false };
const fetcher = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => body });
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation((url: string) => url.includes("issues?") ? reply({ issues: [] }) : reply({ reminder: episode })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetcher.mockReset(); });
const show = (actorId = id) => render(<TaskReminder key={actorId} occurrenceId={id} facilityId={id} actorId={actorId} timezone="America/New_York" />);
describe("work reminder", () => {
  it("automatically surfaces due work with no selected snooze time", async () => {
    show(); await screen.findByText("Overdue work reminder");
    expect((screen.getByLabelText("Snooze until") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Record the work separately/)).toBeTruthy();
  });
  it("retries the exact uncertain response after refresh without resubmitting work", async () => {
    show(); await screen.findByText("Overdue work reminder");
    fetcher.mockRejectedValueOnce(new Error("Network interrupted"));
    fireEvent.click(screen.getByText("Acknowledge reminder"));
    await screen.findByRole("alert");
    const failedBody = fetcher.mock.calls.at(-1)?.[1].body;
    fireEvent.click(screen.getByText("Refresh reminder"));
    await waitFor(() => expect(screen.getByText("Retry saved reminder response").hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByText("Retry saved reminder response"));
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[1].body).toBe(failedBody));
    expect(JSON.parse(failedBody).command).toBe("acknowledge");
  });
  it("rejects a nonexistent daylight-saving local time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    show(); await screen.findByText("Overdue work reminder");
    fireEvent.change(screen.getByLabelText("Snooze until"), { target: { value: "2026-03-08T02:30" } });
    const before = fetcher.mock.calls.length;
    fireEvent.click(screen.getByText("Snooze reminder"));
    await screen.findByText("Choose a future snooze time."); expect(fetcher.mock.calls.length).toBe(before); vi.useRealTimers();
  });
  it("discards an older actor's delayed reminder after shared-device identity changes", async () => {
    let resolveOld!: (value: unknown) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = show();
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    view.rerender(<TaskReminder key="new-actor" occurrenceId={id} facilityId={id} actorId="new-actor" timezone="America/New_York" />);
    await screen.findByText("Overdue work reminder");
    await act(async () => resolveOld({ ok: true, status: 200, json: async () => ({ reminder: { ...episode, source_label: "Old actor private content" } }) }));
    expect(screen.queryByText("Old actor private content")).toBeNull();
  });
  it("bounds initial issue episodes and offers the remaining count", async () => {
    fetcher.mockImplementation((url: string) => url.includes("issues?") ? reply({ issues: Array.from({length: 8}, (_, index) => ({id: `00000000-0000-4000-8000-${String(index).padStart(12,"0")}`, summary: "Private unverified label", status: "waiting"})) }) : reply({ reminder: episode }));
    show(); await screen.findByText("Show more issue reminders (3 remaining)");
    await waitFor(() => expect(fetcher.mock.calls.filter(call => !call[0].includes("issues?")).length).toBe(6));
    expect(screen.queryByText("Private unverified label")).toBeNull();
  });
});
