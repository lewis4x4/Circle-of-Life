import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";

vi.mock("./work-inputs", () => ({
  CONTROL: "control",
  DateTimeInput: ({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) => (
    <label htmlFor={id}>
      {label}
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));

import { DrillSourceEntry } from "./drill-source-entry";

const id = "00000000-0000-4000-8000-000000000001";
const facilityId = "33333333-3333-4333-8333-333333333333";
const draftId = "99999999-9999-4999-8999-999999999999";
const finalId = "88888888-8888-4888-8888-888888888888";
const generatorId = "44444444-4444-4444-8444-444444444444";
const heaterId = "55555555-5555-4555-8555-555555555555";
const retiredId = "66666666-6666-4666-8666-666666666666";

const onSaved = vi.fn();
const onLockChange = vi.fn();
const base = { taskId: id, actorId: id, actorName: "Dana Reyes", facilityId, timezone: "America/New_York", disabled: false, onLockChange, onSaved };
const drillProps = { ...base, activityKey: "hfo-al-m05-01" };
const observationProps = { ...base, activityKey: "hfo-al-w01-01" };

const draft = { id: draftId, drill_type: "fire", drill_date: "2026-09-10", drill_time: "10:30:00", outcome: "performed", record_version: 1, finalized_at: null, voided_at: null };
const final = { id: finalId, drill_type: "fire", drill_date: "2026-09-01", drill_time: "09:00:00", outcome: "performed", record_version: 2, finalized_at: "2026-09-01T13:05:00Z", voided_at: null };
const drillList = (logs: unknown[] = [draft, final]) => ({ drill_logs: logs, total: logs.length, drill_type: "fire", state: null });
const assetList = {
  assets: [
    { id: generatorId, name: "North generator", asset_type: "generator", asset_tag: "GEN-1", status: "active" },
    { id: heaterId, name: "Water heater", asset_type: "water_heater", asset_tag: null, status: "active" },
    { id: retiredId, name: "Old generator", asset_type: "generator", asset_tag: "GEN-0", status: "retired" },
  ],
};
const record = (overrides: Record<string, unknown> = {}) => ({
  outcome: "record",
  record: { id: draftId, record_version: 1, finalized_at: "2026-09-13T18:00:00Z", voided_at: null },
  delivery: { event: { id, state: "satisfied" } },
  linked: true,
  replayed: false,
  ...overrides,
});
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const fetchMock = vi.fn();
function routes(handlers: { list?: unknown; assets?: unknown; command?: unknown }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/admin/operations/drill-logs?")) return response(handlers.list ?? drillList());
    if (url.startsWith("/api/admin/operations/assets")) return response(handlers.assets ?? assetList);
    return response(handlers.command ?? record());
  });
}
const posts = () => fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");

beforeEach(() => {
  fetchMock.mockReset();
  onSaved.mockReset();
  onLockChange.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openDrill = () => userEvent.click(screen.getByText("Drill source record"));
const openObservation = () => userEvent.click(screen.getByText("Observation source record"));
const choose = async (recordId: string) => userEvent.click(await screen.findByRole("radio", { name: new RegExp(recordId === draftId ? "2026-09-10" : "2026-09-01") }));

describe("components without a typed source command", () => {
  it("renders nothing for a human review or an unrelated task", () => {
    for (const activityKey of ["hfo-al-a07-01", "hfo-al-a08-01", "hfo-al-d07-01", null]) {
      const { container } = render(<DrillSourceEntry {...base} activityKey={activityKey} />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("drill source commands", () => {
  it("finalizes one draft through the delivered command and states exactly what that proved", async () => {
    routes({});
    const { container } = render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await waitFor(() => expect(fetchMock.mock.calls[0][0]).toContain("drill_type=fire"));
    // The reader is asked for this component's drill type only, so a tornado drill never appears here.
    expect(fetchMock.mock.calls[0][0]).toContain(`facility_id=${facilityId}`);
    await choose(draftId);
    await userEvent.click(screen.getByRole("button", { name: "Finalize this drill record" }));
    const notice = await screen.findByText(/satisfied its matching requirement once/);
    // The same message that reports satisfaction also keeps the separate review outstanding.
    expect(notice.textContent).toMatch(/Any separate review, evidence or verification still applies/);
    const [url, init] = posts()[0];
    expect(url).toBe(`/api/admin/operations/drill-logs/${draftId}`);
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["action", "payload", "request_key"]);
    expect(body.action).toBe("finalize");
    expect(body.payload).toEqual({});
    expect(onSaved).toHaveBeenCalledOnce();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("offers only drafts to finalize and only final records to correct or void", async () => {
    routes({});
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    expect(await screen.findByRole("radio", { name: /2026-09-10/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /2026-09-01/ })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText(/Command/), "correct");
    expect(await screen.findByRole("radio", { name: /2026-09-01/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /2026-09-10/ })).toBeNull();
  });

  it("says a failed drill keeps its follow-up open", async () => {
    routes({ list: drillList([{ ...draft, outcome: "failed" }]) });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await screen.findByText(/recorded as failed/);
    expect(screen.getByText(/does not close the problem/)).toBeTruthy();
  });

  it("sends the version it read when correcting, and requires a reason first", async () => {
    routes({ command: record({ record: { id: finalId, record_version: 3, finalized_at: final.finalized_at, voided_at: null } }) });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await userEvent.selectOptions(await screen.findByLabelText(/Command/), "correct");
    await choose(finalId);
    expect(screen.getByRole("button", { name: "Record a correction" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason for this correction/), "Time misread");
    await userEvent.click(screen.getByRole("button", { name: "Record a correction" }));
    await screen.findByText(/satisfied its matching requirement once/);
    const body = JSON.parse(posts()[0][1].body);
    expect(body).toMatchObject({ action: "correct", expected_version: 2, payload: { reason: "Time misread" } });
  });

  it("retries an unknown result as the same request instead of recording a second one", async () => {
    routes({});
    fetchMock.mockImplementationOnce(async () => response(drillList())).mockImplementationOnce(async () => { throw new Error("lost"); });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await choose(draftId);
    await userEvent.click(screen.getByRole("button", { name: "Finalize this drill record" }));
    await screen.findByText(/result of this record is unknown/);
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same drill command" }));
    await screen.findByText(/satisfied its matching requirement once/);
    const sent = posts();
    expect(sent).toHaveLength(2);
    expect(sent[0][1].body).toBe(sent[1][1].body);
  });

  it("treats a rejection as nothing recorded and re-reads the current records", async () => {
    routes({ command: { error: "Drill log is already final" } });
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return response({ error: "Drill log is already final", outcome: "conflict" }, 409);
      return response(drillList());
    });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await choose(draftId);
    const readsBefore = fetchMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Finalize this drill record" }));
    await screen.findByText(/Drill log is already final. Nothing was recorded/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry same drill command" })).toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(readsBefore + 1));
  });

  it("does not claim satisfaction when the record did not link", async () => {
    routes({ command: record({ linked: false, link_reason: "no_checklist_activity" }) });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await choose(draftId);
    await userEvent.click(screen.getByRole("button", { name: "Finalize this drill record" }));
    await screen.findByText(/did not link: no_checklist_activity/);
    expect(screen.queryByText(/satisfied its matching requirement once/)).toBeNull();
  });

  it("names an unauthorised recorder instead of claiming no requirement was found", async () => {
    // Migration 358 refuses the delivery of a final record whose author is not
    // on the published recorder list. The requirement was found; this person
    // did not satisfy it. Saying "no matching requirement" would be false, and
    // link_reason is never set on this path — the reason is on the delivery.
    routes({
      command: record({
        linked: false,
        delivery: { event: { id, state: "refused", reason: "recorder_not_authorized", detail: "Source author is not on the published recorder list for this activity" } },
      }),
    });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await choose(draftId);
    await userEvent.click(screen.getByRole("button", { name: "Finalize this drill record" }));
    await screen.findByText(/recorder_not_authorized/);
    expect(screen.getByText(/not on the published recorder list/)).toBeTruthy();
    expect(screen.queryByText(/no matching requirement was found/)).toBeNull();
    expect(screen.queryByText(/satisfied its matching requirement once/)).toBeNull();
  });

  it("states that an unavailable read is not a satisfied requirement", async () => {
    fetchMock.mockImplementation(async () => { throw new Error("revoked"); });
    render(<DrillSourceEntry {...drillProps} />);
    await openDrill();
    await screen.findByText(/Unavailable does not mean no drill was recorded/);
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("observation source command", () => {
  it("offers only assets the database will accept and records a person's own observation", async () => {
    routes({});
    const { container } = render(<DrillSourceEntry {...observationProps} />);
    await openObservation();
    const assetSelect = await screen.findByLabelText(/Asset observed/);
    const options = Array.from(assetSelect.querySelectorAll("option")).map((option) => option.textContent);
    expect(options.some((label) => label?.includes("North generator"))).toBe(true);
    expect(options.some((label) => label?.includes("Water heater"))).toBe(false);
    expect(options.some((label) => label?.includes("Old generator"))).toBe(false);
    await userEvent.selectOptions(assetSelect, generatorId);
    await userEvent.type(screen.getByLabelText(/When you observed it/), "2026-09-13T09:15");
    await userEvent.click(screen.getByRole("button", { name: "Record this observation" }));
    await screen.findByText(/satisfied its matching requirement once/);
    const [url, init] = posts()[0];
    expect(url).toBe("/api/admin/operations/asset-observations");
    const body = JSON.parse(init.body);
    expect(body.payload).toMatchObject({ facility_id: facilityId, asset_id: generatorId, observation_kind: "generator_test", basis: "staff_observed", outcome: "pass" });
    // The local time the person chose is sent as one instant, not as a floating local string.
    expect(body.payload.observed_at).toBe("2026-09-13T13:15:00.000Z");
    expect(screen.getByText(/not an observation/)).toBeTruthy();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("requires a stated failure before a failed observation can be recorded", async () => {
    routes({});
    render(<DrillSourceEntry {...observationProps} />);
    await openObservation();
    await userEvent.selectOptions(await screen.findByLabelText(/Asset observed/), generatorId);
    await userEvent.type(screen.getByLabelText(/When you observed it/), "2026-09-13T09:15");
    await userEvent.selectOptions(screen.getByLabelText(/Observed outcome/), "fail");
    expect(screen.getByRole("button", { name: "Record this observation" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/What failed/), "Did not start");
    await userEvent.click(screen.getByRole("button", { name: "Record this observation" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(JSON.parse(posts()[0][1].body).payload).toMatchObject({ outcome: "fail", issue_summary: "Did not start" });
  });

  it("offers no observation when the site has no asset the command accepts", async () => {
    routes({ assets: { assets: [{ id: heaterId, name: "Water heater", asset_type: "water_heater", asset_tag: null, status: "active" }] } });
    render(<DrillSourceEntry {...observationProps} />);
    await openObservation();
    await screen.findByText(/No current generator asset is available/);
    expect(screen.queryByRole("button", { name: "Record this observation" })).toBeNull();
  });
});
