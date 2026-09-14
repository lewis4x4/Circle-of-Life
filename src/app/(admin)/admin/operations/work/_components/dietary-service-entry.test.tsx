import { render, screen, cleanup } from "@testing-library/react";
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

import { DietaryServiceEntry } from "./dietary-service-entry";
import { dietaryServiceSourceMap } from "@/lib/operations/dietary-service-source-map";

const id = "00000000-0000-4000-8000-000000000001";
const facilityId = "33333333-3333-4333-8333-333333333333";
const extinguisherId = "44444444-4444-4444-8444-444444444444";
const hoodId = "55555555-5555-4555-8555-555555555555";
const kitchenId = "77777777-7777-4777-8777-777777777777";
const aedId = "22222222-2222-4222-8222-222222222222";
const vendorId = "66666666-6666-4666-8666-666666666666";

const onSaved = vi.fn();
const onLockChange = vi.fn();
const base = { taskId: id, actorId: id, actorName: "Dana Reyes", facilityId, timezone: "America/New_York", disabled: false, onLockChange, onSaved };

const assets = {
  assets: [
    { id: extinguisherId, name: "Kitchen extinguisher", asset_type: "fire_extinguisher", asset_tag: "EXT-2", status: "active" },
    { id: hoodId, name: "Hood suppression", asset_type: "hood_suppression", asset_tag: null, status: "active" },
    { id: kitchenId, name: "Range", asset_type: "kitchen_equipment", asset_tag: null, status: "active" },
    { id: aedId, name: "Lobby AED", asset_type: "aed", asset_tag: "AED-1", status: "active" },
    { id: "99999999-9999-4999-8999-999999999999", name: "Retired extinguisher", asset_type: "fire_extinguisher", asset_tag: "EXT-0", status: "retired" },
  ],
};
const vendors = { vendors: [{ id: vendorId, name: "Croft Fire Safety", status: "active" }] };
const record = (overrides: Record<string, unknown> = {}) => ({ outcome: "record", record: { id, record_version: 1 }, delivery: { event: { id, state: "satisfied" } }, linked: true, replayed: false, ...overrides });
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const fetchMock = vi.fn();
function routes(command: unknown = record(), status = 200) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST") return response(command, status);
    if (url.startsWith("/api/admin/operations/assets")) return response(assets);
    if (url.startsWith("/api/admin/operations/vendors")) return response(vendors);
    return response({});
  });
}
const posts = () => fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
const sentPayload = () => JSON.parse(posts()[0][1].body).payload;

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

const open = (name: string) => userEvent.click(screen.getByText(name));

describe("the COL-159 source map", () => {
  it("gives a typed command to exactly the eleven components that have one", () => {
    const commanded = dietaryServiceSourceMap.filter((row) => row.command);
    expect(commanded).toHaveLength(11);
    expect(new Set(commanded.map((row) => row.sourceId))).toEqual(new Set(["AL-W04", "AL-M01", "AL-M08", "AL-M11", "AL-Y01", "AL-Y02", "AL-Y03", "AL-Y04", "AL-Y05"]));
    // The human rows and the COL-154 records stay without a command here.
    for (const key of ["hfo-al-d01-01", "hfo-al-d11-01", "hfo-al-a08-01", "hfo-al-y07-01", "hfo-al-w01-01", "hfo-al-a07-03"]) {
      expect(dietaryServiceSourceMap.find((row) => row.key === key)?.command ?? null).toBeNull();
    }
    expect(dietaryServiceSourceMap.find((row) => row.key === "hfo-al-w01-01")?.fallback).toMatch(/drill and generator surface/);
    expect(dietaryServiceSourceMap.find((row) => row.key === "hfo-al-a08-01")?.fallback).toMatch(/never satisfies its own review/);
  });

  it("renders nothing for a component that keeps the human path", () => {
    for (const activityKey of ["hfo-al-d01-01", "hfo-al-a08-01", "hfo-al-w01-01", null]) {
      const { container } = render(<DietaryServiceEntry {...base} activityKey={activityKey} />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dietary records", () => {
  it("records a meal substitution at meal level and names no resident", async () => {
    routes();
    const { container } = render(<DietaryServiceEntry {...base} activityKey="hfo-al-m08-01" />);
    await open("Dietary source record");
    await userEvent.type(await screen.findByLabelText(/When it was done/), "2026-09-13T13:05");
    await userEvent.type(screen.getByLabelText(/Service date/), "2026-09-13");
    await userEvent.selectOptions(screen.getByLabelText(/^Meal$/), "lunch");
    await userEvent.type(screen.getByLabelText(/Planned item/), "Baked cod");
    await userEvent.type(screen.getByLabelText(/Substitute served/), "Roast chicken");
    await userEvent.type(screen.getByLabelText(/Reason for the substitution/), "Delivery short");
    await userEvent.click(screen.getByRole("button", { name: "Record this dietary record" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(posts()[0][0]).toBe("/api/admin/operations/dietary-records");
    expect(sentPayload()).toEqual({
      facility_id: facilityId,
      record_kind: "meal_substitution",
      performed_at: "2026-09-13T17:05:00.000Z",
      service_date: "2026-09-13",
      meal_period: "lunch",
      planned_item: "Baked cod",
      substitute_item: "Roast chicken",
      substitution_reason: "Delivery short",
    });
    // A substitution is never recorded as failed and never carries menu fields.
    expect(Object.keys(sentPayload())).not.toContain("outcome");
    expect(Object.keys(sentPayload())).not.toContain("menu_label");
    expect(screen.getByText(/No resident is named or referenced here/)).toBeTruthy();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("refuses a nonexistent daylight-saving local time out loud and records nothing", async () => {
    // 02:30 on the spring-forward Sunday never happens in America/New_York.
    // Sending it would store 01:30 — an hour nobody chose — so it is refused,
    // and the refusal is stated rather than swallowed by a dead button.
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-m08-01" />);
    await open("Dietary source record");
    await userEvent.type(await screen.findByLabelText(/When it was done/), "2026-03-08T02:30");
    await userEvent.type(screen.getByLabelText(/Service date/), "2026-03-08");
    await userEvent.selectOptions(screen.getByLabelText(/^Meal$/), "lunch");
    await userEvent.type(screen.getByLabelText(/Planned item/), "Baked cod");
    await userEvent.type(screen.getByLabelText(/Substitute served/), "Roast chicken");
    await userEvent.type(screen.getByLabelText(/Reason for the substitution/), "Delivery short");
    await userEvent.click(screen.getByRole("button", { name: "Record this dietary record" }));
    await screen.findByText(/does not exist in this site's time zone/);
    expect(posts()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("will not send an incomplete substitution", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-m08-01" />);
    await open("Dietary source record");
    await userEvent.type(await screen.findByLabelText(/When it was done/), "2026-09-13T13:05");
    await userEvent.type(screen.getByLabelText(/Planned item/), "Baked cod");
    expect(screen.getByRole("button", { name: "Record this dietary record" })).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it("records a menu approval as stated without claiming the approver was verified", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y01-01" />);
    await open("Dietary source record");
    await userEvent.type(await screen.findByLabelText(/When it was done/), "2026-09-13T09:00");
    await userEvent.type(screen.getByLabelText(/Menu as labelled/), "Fall cycle week 2");
    await userEvent.type(screen.getByLabelText(/Approver as stated/), "R. Patel RD");
    await userEvent.click(screen.getByRole("button", { name: "Record this dietary record" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(sentPayload()).toMatchObject({ record_kind: "menu_approval", menu_label: "Fall cycle week 2", approver_label: "R. Patel RD" });
    expect(screen.getByText(/does not verify the approver's credential/)).toBeTruthy();
  });

  it("requires a stated failure on a failed emergency food supply check", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-m01-01" />);
    await open("Dietary source record");
    await userEvent.type(await screen.findByLabelText(/When it was done/), "2026-09-13T08:00");
    await userEvent.selectOptions(screen.getByLabelText(/Outcome/), "failed");
    expect(screen.getByRole("button", { name: "Record this dietary record" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/What failed/), "Two cases expired");
    await userEvent.click(screen.getByRole("button", { name: "Record this dietary record" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(sentPayload()).toMatchObject({ record_kind: "emergency_food_supply_check", outcome: "failed", issue_summary: "Two cases expired" });
    expect(screen.getByText(/not a complete sanitation log/)).toBeTruthy();
  });
});

describe("service records", () => {
  it("records an asset service against an asset of the type the command accepts", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y03-01" />);
    await open("Service source record");
    const assetSelect = await screen.findByLabelText(/Asset serviced/);
    const options = Array.from(assetSelect.querySelectorAll("option")).map((option) => option.textContent ?? "");
    expect(options.some((label) => label.includes("Kitchen extinguisher"))).toBe(true);
    expect(options.some((label) => label.includes("Retired extinguisher"))).toBe(false);
    expect(options.some((label) => label.includes("Lobby AED"))).toBe(false);
    await userEvent.selectOptions(assetSelect, extinguisherId);
    await userEvent.type(screen.getByLabelText(/When the service was performed/), "2026-09-13T11:00");
    await userEvent.click(screen.getByRole("button", { name: "Record this service" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(posts()[0][0]).toBe("/api/admin/operations/service-records");
    expect(sentPayload()).toMatchObject({ service_kind: "extinguisher_inspection", asset_id: extinguisherId, performer_kind: "staff", outcome: "pass" });
    expect(Object.keys(sentPayload())).not.toContain("vendor_id");
    expect(screen.getByText(/does not change the asset's approved next service date/)).toBeTruthy();
  });

  it("accepts either asset type a hood cleaning allows", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y05-01" />);
    await open("Service source record");
    const options = Array.from((await screen.findByLabelText(/Asset serviced/)).querySelectorAll("option")).map((option) => option.textContent ?? "");
    expect(options.some((label) => label.includes("Hood suppression"))).toBe(true);
    expect(options.some((label) => label.includes("Range"))).toBe(true);
    expect(options.some((label) => label.includes("Kitchen extinguisher"))).toBe(false);
  });

  it("records a facility service against the site and names a site-linked vendor only", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y04-02" />);
    await open("Service source record");
    expect(screen.queryByLabelText(/Asset serviced/)).toBeNull();
    expect(await screen.findByText(/One vendor visit covering separate inspections is separate records/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/When the service was performed/), "2026-09-13T10:00");
    await userEvent.selectOptions(screen.getByLabelText(/Who performed it/), "vendor");
    expect(screen.getByRole("button", { name: "Record this service" })).toBeDisabled();
    await userEvent.selectOptions(await screen.findByLabelText(/^Vendor$/), vendorId);
    await userEvent.type(screen.getByLabelText(/Technician name as stated/), "Chad");
    await userEvent.click(screen.getByRole("button", { name: "Record this service" }));
    await screen.findByText(/satisfied its matching requirement once/);
    const payload = sentPayload();
    expect(payload).toMatchObject({ service_kind: "sprinkler_inspection", performer_kind: "vendor", vendor_id: vendorId, performer_label: "Chad" });
    expect(Object.keys(payload)).not.toContain("asset_id");
    expect(Object.keys(payload)).not.toContain("performed_by");
  });

  it("offers no service when the site has no asset of the required type", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-m11-01" />);
    await open("Service source record");
    await screen.findByText(/No current ac unit asset is available/);
    expect(screen.queryByRole("button", { name: "Record this service" })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("repeats a refusal by name, states nothing was recorded and offers no retry of it", async () => {
    routes({ error: "An extinguisher inspection is recorded against a fire extinguisher", outcome: "validation" }, 400);
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y03-01" />);
    await open("Service source record");
    await userEvent.selectOptions(await screen.findByLabelText(/Asset serviced/), extinguisherId);
    await userEvent.type(screen.getByLabelText(/When the service was performed/), "2026-09-13T11:00");
    await userEvent.click(screen.getByRole("button", { name: "Record this service" }));
    await screen.findByText(/An extinguisher inspection is recorded against a fire extinguisher. Nothing was recorded/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry same service record" })).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("retries an unknown service result as the same request", async () => {
    let firstPost = true;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") {
        if (firstPost) { firstPost = false; throw new Error("lost"); }
        return response(record());
      }
      if (url.startsWith("/api/admin/operations/assets")) return response(assets);
      return response(vendors);
    });
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-y02-01" />);
    await open("Service source record");
    await userEvent.type(await screen.findByLabelText(/When the service was performed/), "2026-09-13T12:00");
    await userEvent.click(screen.getByRole("button", { name: "Record this service" }));
    await screen.findByText(/result of this record is unknown/);
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same service record" }));
    await screen.findByText(/satisfied its matching requirement once/);
    const sent = posts();
    expect(sent).toHaveLength(2);
    expect(sent[0][1].body).toBe(sent[1][1].body);
  });
});

describe("AED observations", () => {
  it("reuses the observation command against an AED and keeps operation and equipment separate", async () => {
    routes();
    render(<DietaryServiceEntry {...base} activityKey="hfo-al-w04-02" />);
    await open("Observation source record");
    const options = Array.from((await screen.findByLabelText(/Asset observed/)).querySelectorAll("option")).map((option) => option.textContent ?? "");
    expect(options.some((label) => label.includes("Lobby AED"))).toBe(true);
    expect(options.some((label) => label.includes("Kitchen extinguisher"))).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText(/Asset observed/), aedId);
    await userEvent.type(screen.getByLabelText(/When you observed it/), "2026-09-13T07:30");
    await userEvent.click(screen.getByRole("button", { name: "Record this observation" }));
    await screen.findByText(/satisfied its matching requirement once/);
    expect(posts()[0][0]).toBe("/api/admin/operations/asset-observations");
    expect(sentPayload()).toMatchObject({ observation_kind: "aed_equipment_check", basis: "staff_observed", asset_id: aedId });
  });
});
