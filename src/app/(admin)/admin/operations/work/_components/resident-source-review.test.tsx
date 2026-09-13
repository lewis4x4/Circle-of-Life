import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResidentSourceReview } from "./resident-source-review";
import { residentReviewMap } from "@/lib/operations/resident-review-map";
import type { WorkspaceItem } from "@/lib/operations/workspace";
const task = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const source = { source_id: "00000000-0000-0000-0000-000000000003", source_version: "a".repeat(64), source_at: "2026-09-13", label: "Recorded observation", evidence_meaning: "Observation only; not proof of review." };
const fetchMock = vi.fn();
const props = () => ({ item: { occurrence: { id: task, activity_id: residentReviewMap.find(row => row.key === "hfo-al-d07-01")!.id, subject_id: "resident", occurrence_revision: "b".repeat(64) }, rules: { inputs: [], evidence: [], can_record: true } } as unknown as WorkspaceItem, actorId: actor, actorName: "Current reviewer", facilityId: "facility", timezone: "America/New_York", disabled: false, onSaved: vi.fn(), onLockChange: vi.fn() });
const reply = (overrides = {}) => ({ task_id: task, subject_kind: "resident", eligible: true, allowed_families: ["rounding"], family: "rounding", period: { start_date: "2026-09-12", end_date: "2026-09-13" }, availability: "available", reason: null, items: [source], next_cursor: null, complete: true, ...overrides });
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
async function open() { await userEvent.click(screen.getByText("Resident review source context")); await screen.findByText(/Recorded by Current reviewer/); }
async function period() { fireEvent.change(screen.getByLabelText("Review start date"), { target: { value: "2026-09-12" } }); fireEvent.change(screen.getByLabelText("Review end date"), { target: { value: "2026-09-13" } }); }
async function choose() { await userEvent.click(await screen.findByRole("checkbox")); }
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("resident source review", () => {
  it("preserves all 36 source items and 41 components with only resident review eligible mappings", () => {
    expect(new Set(residentReviewMap.map(row => row.sourceId)).size).toBe(36); expect(residentReviewMap).toHaveLength(41);
    expect(residentReviewMap.filter(row => row.families.length).every(row => row.kind === "record_review" && row.subjectKind === "resident")).toBe(true);
  });
  it("shows unsupported native action fallback without a review mutation", async () => {
    const p = props(); p.item.occurrence.activity_id = residentReviewMap.find(row => row.sourceId === "AL-N01")!.id;
    render(<ResidentSourceReview {...p} />); await userEvent.click(screen.getByText("Resident review source context"));
    await screen.findByText(/No source-review action is available/); expect(fetchMock).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Record review with selected sources" })).toBeNull();
  });
  it("records selected version with current self and existing findings payload", async () => {
    const p = props(); fetchMock.mockResolvedValueOnce(response(reply())).mockResolvedValueOnce(response({ outcome: "receipt", receipt: { id: "receipt", recorder_id: actor }, occurrence: { id: task }, references: [{ reference_id: "reference" }] })).mockResolvedValue(response(reply()));
    render(<ResidentSourceReview {...p} />); await open(); await period(); await choose();
    await userEvent.type(screen.getByLabelText("Review findings"), "Reviewed with follow-up"); await userEvent.click(screen.getByRole("button", { name: "Record review with selected sources" }));
    await screen.findByText(/Review recorded/); const body = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === "POST")![1].body);
    expect(body.payload).toEqual({ outcome: "performed", values: {}, note: "Reviewed with follow-up" }); expect(body.references[0]).toMatchObject({ family: "rounding", source_version: source.source_version }); expect(body.period).toEqual({ start_date: "2026-09-12", end_date: "2026-09-13" }); expect(p.onSaved).toHaveBeenCalledOnce();
  });
  it("keeps uncertain save body unchanged and prohibits a second different review", async () => {
    fetchMock.mockResolvedValueOnce(response(reply())).mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(response({}));
    render(<ResidentSourceReview {...props()} />); await open(); await period(); await choose(); await userEvent.click(screen.getByRole("button", { name: "Record review with selected sources" }));
    await screen.findByText(/save result is unknown/); expect(screen.getByLabelText("Review end date")).toBeDisabled(); await userEvent.click(screen.getByRole("button", { name: "Retry same review" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)); expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body); expect(screen.queryByText(/Review recorded/)).toBeNull();
  });
  it("clears selections and aborts reads after period changes", async () => {
    fetchMock.mockResolvedValueOnce(response(reply())).mockImplementation(() => new Promise(() => {})); render(<ResidentSourceReview {...props()} />); await open(); await period(); await choose();
    const firstSignal = fetchMock.mock.calls[0][1].signal;
    fireEvent.change(screen.getByLabelText("Review end date"), { target: { value: "2026-09-14" } });
    expect(firstSignal.aborted).toBe(true); expect(screen.getByRole("button", { name: "Record review with selected sources" })).toBeDisabled();
  });
  it("rejects mismatched scope replies and never labels them empty", async () => {
    fetchMock.mockResolvedValue(response(reply({ task_id: source.source_id }))); render(<ResidentSourceReview {...props()} />); await open(); await period(); await screen.findByText(/unavailable does not mean no records/); expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("remounts on actor change and aborts pending request without replay", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); const p = props(); const { rerender } = render(<ResidentSourceReview {...p} />); await open(); await period(); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); const signal = fetchMock.mock.calls[0][1].signal;
    rerender(<ResidentSourceReview {...p} actorId={source.source_id} />); expect(signal.aborted).toBe(true); expect(screen.queryByLabelText("Review end date")).toBeNull(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("loads further pages without claiming full clinical coverage", async () => {
    fetchMock.mockResolvedValueOnce(response(reply({ complete: false, next_cursor: source.source_id }))).mockResolvedValueOnce(response(reply({ items: [{ ...source, source_id: actor, label: "Second observation" }] })));
    render(<ResidentSourceReview {...props()} />); await open(); await period(); await screen.findByText("More source pages remain.", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: "Load more source context" })); await screen.findByText(/This family page set is complete/); expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain(`cursor=${source.source_id}`);
  });
  it("has labeled source and review controls without structural axe violations", async () => {
    fetchMock.mockResolvedValue(response(reply())); const { container } = render(<ResidentSourceReview {...props()} />); await open(); await period(); await choose();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("uses the authorized activity key for another organization's fresh activity UUID", async () => {
    const p = props(); p.item.occurrence.activity_id = source.source_id; p.item.occurrence.activity_key = "hfo-al-d07-01";
    render(<ResidentSourceReview {...p} />); await open(); expect(screen.getByLabelText("Source family")).toHaveValue("rounding");
  });

  it("keeps two simultaneously open source panels distinguishable without duplicate landmarks", async () => {
    const first = props(); const second = props(); second.item.occurrence.id = source.source_id;
    const { container } = render(<><ResidentSourceReview {...first} /><ResidentSourceReview {...second} /></>);
    for (const summary of screen.getAllByText("Resident review source context")) await userEvent.click(summary);
    await waitFor(() => expect(screen.getAllByText(/Recorded by Current reviewer/)).toHaveLength(2));
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

});
