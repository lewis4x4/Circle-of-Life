import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
import { MedicationShiftCommandError } from "@/lib/med-tech/shift-commands";

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), role: "nurse", loadError: null as null | {message:string}, facility: "facility-a" }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: mocks.role, loading: false, organizationId: "org" }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: mocks.facility, availableFacilities: [{id:"facility-a",name:"Homewood"}] }) }));
vi.mock("@/lib/med-tech/shift-commands", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/med-tech/shift-commands")>(),
  createMedicationShift: mocks.create, listMedicationShiftStaff: mocks.list,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: (table:string) => {
  const result = { data: table === "residents" ? [{id:"resident",first_name:"Jane",last_name:"Doe"}] : [{id:"existing",user_id:"staff",shift_start:"2030-01-01T12:00:00Z",shift_end:"2030-01-01T20:00:00Z",status:"scheduled"}], error: mocks.loadError };
  const query = { select:()=>query, eq:()=>query, is:()=>query, order:()=>query, limit:()=>query, then: (resolve: (value:unknown)=>unknown) => Promise.resolve(result).then(resolve) };
  return query;
} }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.role="nurse"; mocks.facility="facility-a"; mocks.loadError=null; mocks.list.mockResolvedValue([{id:"staff",full_name:"Nurse Smith",app_role:"nurse"}]); mocks.create.mockResolvedValue("saved-shift"); });
async function fill() {
  await screen.findByRole("option", {name:"Nurse Smith (Nurse)"});
  fireEvent.change(screen.getByLabelText("Staff member"), {target:{value:"staff"}});
  fireEvent.change(screen.getByLabelText("Start time"), {target:{value:"2030-01-01T07:00"}});
  fireEvent.change(screen.getByLabelText("End time"), {target:{value:"2030-01-01T15:00"}});
  fireEvent.click(screen.getByLabelText("Jane Doe"));
}
describe("Medication shift assignments", () => {
  it("starts with explicit empty times and saves scoped Eastern assignment", async () => {
    render(<Page/>);
    expect(screen.getByLabelText("Start time")).toHaveValue("");
    expect(screen.getByLabelText("End time")).toHaveValue("");
    await fill();
    expect(screen.getByText(/scheduled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Save assignment"}));
    await screen.findByText(/Medication shift saved/);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({facilityId:"facility-a",userId:"staff",residentIds:["resident"],startsAt:"2030-01-01T12:00:00.000Z",endsAt:"2030-01-01T20:00:00.000Z"}));
    expect(screen.getByLabelText("Start time")).toHaveValue("");
  });
  it("locks an ambiguous request and retries identical payload even after global facility changes", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Network response lost"));
    const view=render(<Page/>); await fill();
    fireEvent.click(screen.getByRole("button",{name:"Save assignment"}));
    await screen.findByText("Network response lost");
    expect(screen.getByLabelText("Start time")).toBeDisabled();
    const original=mocks.create.mock.calls[0][0];
    mocks.facility="facility-b"; view.rerender(<Page/>);
    fireEvent.click(screen.getByRole("button",{name:"Retry original assignment"}));
    await screen.findByText(/Medication shift saved/);
    expect(mocks.create.mock.calls[1][0]).toEqual(original);
  });
  it("unlocks and preserves the draft after a definite initial rejection", async () => {
    mocks.create.mockRejectedValueOnce(new MedicationShiftCommandError("Staff assignment was revoked", true));
    render(<Page/>); await fill();
    fireEvent.click(screen.getByRole("button", {name:"Save assignment"}));
    await screen.findByText("Staff assignment was revoked");
    expect(screen.getByLabelText("Start time")).not.toBeDisabled();
    expect(screen.getByLabelText("Start time")).toHaveValue("2030-01-01T07:00");
    fireEvent.change(screen.getByLabelText("Start time"), {target:{value:"2030-01-01T08:00"}});
    fireEvent.click(screen.getByRole("button", {name:"Save assignment"}));
    await screen.findByText(/Medication shift saved/);
    expect(mocks.create.mock.calls[1][0].id).not.toEqual(mocks.create.mock.calls[0][0].id);
    expect(mocks.create.mock.calls[1][0].startsAt).toBe("2030-01-01T13:00:00.000Z");
  });
  it("keeps the original request locked when an ambiguous attempt is followed by definite rejection", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Response lost"))
      .mockRejectedValueOnce(new MedicationShiftCommandError("Access revoked", true));
    render(<Page/>); await fill();
    fireEvent.click(screen.getByRole("button", {name:"Save assignment"}));
    await screen.findByText("Response lost");
    const original = mocks.create.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", {name:"Retry original assignment"}));
    await screen.findByText("Access revoked");
    expect(screen.getByLabelText("Start time")).toBeDisabled();
    expect(screen.getByRole("button", {name:"Retry original assignment"})).toBeEnabled();
    expect(mocks.create.mock.calls[1][0]).toEqual(original);
    fireEvent.click(screen.getByRole("button", {name:"Retry original assignment"}));
    await screen.findByText(/Medication shift saved/);
    expect(mocks.create.mock.calls[2][0]).toEqual(original);
  });
  it("distinguishes failed loading from an empty assignment list", async () => {
    mocks.loadError={message:"Access denied"}; render(<Page/>);
    await screen.findByText(/Unable to load assignments: Access denied/);
    expect(screen.queryByText("No medication shifts assigned.")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Save assignment"})).toBeDisabled();
  });
  it("excludes unauthorized roles and prevents load", async () => {
    mocks.role="manager"; render(<Page/>);
    expect(screen.getByRole("alert")).toHaveTextContent("require an owner");
    await waitFor(() => expect(mocks.list).not.toHaveBeenCalled());
  });
  it("rejects a window longer than 24 hours", async () => {
    render(<Page/>); await fill();
    fireEvent.change(screen.getByLabelText("End time"),{target:{value:"2030-01-03T07:00"}});
    fireEvent.click(screen.getByRole("button",{name:"Save assignment"}));
    await screen.findByText(/within 24 hours/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
