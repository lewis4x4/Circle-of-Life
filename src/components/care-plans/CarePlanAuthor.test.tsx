import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CarePlanAuthor } from "./CarePlanAuthor";

const authMock = vi.hoisted(() => ({ appRole: "nurse", user: { id: "nurse-1" } }));
const rpcMock = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  error: null as string | null,
}));
const guardMock = vi.hoisted(() => ({ guards: [] as Array<(silent?: boolean) => boolean> }));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: authMock.appRole, user: authMock.user }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcMock.calls.push({ fn, args });
      if (rpcMock.error) return { data: null, error: { message: rpcMock.error } };
      return { data: args.p_id, error: null };
    },
  }),
}));

vi.mock("@/components/layout/navigation-pending", () => ({
  registerRouteLeaveGuard: (guard: (silent?: boolean) => boolean) => {
    guardMock.guards.push(guard);
    return () => {
      guardMock.guards = guardMock.guards.filter((g) => g !== guard);
    };
  },
}));

const activePlan = { id: "plan-2", version: 2, status: "active", effective_date: "2026-01-01", review_due_date: "2027-01-01" };
const loadedItems = [
  { id: "item-a", category: "bathing", title: "Bathing", description: "Needs help in the shower", assistance_level: "limited_assist", frequency: "Daily", goal: "", interventions: ["Set up shower chair"], special_instructions: "" },
  { id: "item-b", category: "dressing", title: "Dressing", description: "Buttons and laces", assistance_level: "supervision", frequency: "", goal: "", interventions: [], special_instructions: "" },
];

function renderFirst(onSaved = vi.fn()) {
  return render(
    <CarePlanAuthor residentId="res-1" residentName="Marsha Wheeler" facilityName="Homewood Lodge" mode="first" previous={null} initialItems={[]} onSaved={onSaved} />,
  );
}

function renderRevision(onSaved = vi.fn()) {
  return render(
    <CarePlanAuthor residentId="res-1" residentName="Marsha Wheeler" facilityName="Homewood Lodge" mode="revision" previous={activePlan} initialItems={loadedItems} onSaved={onSaved} />,
  );
}

function fillNeed(index = 0) {
  const selects = screen.getAllByLabelText(/^Category/);
  fireEvent.change(selects[index], { target: { value: "bathing" } });
  fireEvent.change(screen.getAllByLabelText(/^Assistance level/)[index], { target: { value: "limited_assist" } });
  fireEvent.change(screen.getAllByLabelText(/^Need title/)[index], { target: { value: "Bathing" } });
  fireEvent.change(screen.getAllByLabelText(/^Description of need/)[index], { target: { value: "Needs help in the shower" } });
}

describe("<CarePlanAuthor />", () => {
  beforeEach(() => {
    authMock.appRole = "nurse";
    rpcMock.calls = [];
    rpcMock.error = null;
    guardMock.guards = [];
    window.confirm = vi.fn(() => false);
  });

  it("renders nothing for a role that cannot draft", () => {
    authMock.appRole = "caregiver";
    const { container } = renderFirst();
    expect(container).toBeEmptyDOMElement();
  });

  it("names the first-plan state and never claims a signed plan exists", () => {
    renderFirst();
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    expect(screen.getByRole("heading", { name: "New care plan" })).toBeInTheDocument();
    expect(screen.getByText(/No plan is on file for this resident/)).toBeInTheDocument();
    expect(screen.queryByText(/stays in effect/)).not.toBeInTheDocument();
    expect(screen.getByText("Marsha Wheeler · Homewood Lodge")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument();
    // Dates start empty: the editor does not decide them for the operator.
    expect(screen.getByLabelText(/Effective date/)).toHaveValue("");
    expect(screen.getByLabelText(/Review due/)).toHaveValue("");
  });

  it("names the version being revised and the reason field", () => {
    renderRevision();
    fireEvent.click(screen.getByRole("button", { name: "Revise care plan" }));
    expect(screen.getByRole("heading", { name: "Revise care plan (v2)" })).toBeInTheDocument();
    expect(screen.getByText(/V2 stays in effect until a reviewer signs the new one/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason for revision/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Need 1 · Bathing · Bathing · Limited assist" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Remove from this revision" })).toHaveLength(2);
  });

  it("shows a validation summary and focuses the first gap instead of saving", async () => {
    renderFirst();
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for clinical review" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Effective date is required.");
    expect(summary).toHaveTextContent("Need 1: choose a category.");
    expect(rpcMock.calls).toHaveLength(0);
    expect(screen.getByLabelText(/Effective date/)).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a review date before the effective date", async () => {
    renderFirst();
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    fireEvent.change(screen.getByLabelText(/Effective date/), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText(/Review due/), { target: { value: "2026-09-01" } });
    fillNeed();
    fireEvent.click(screen.getByRole("button", { name: "Save for clinical review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Review due date cannot be before the effective date.");
    expect(rpcMock.calls).toHaveLength(0);
  });

  it("saves a first plan through the revision RPC with no previous version", async () => {
    const onSaved = vi.fn();
    renderFirst(onSaved);
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    fireEvent.change(screen.getByLabelText(/Effective date/), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText(/Review due/), { target: { value: "2027-09-16" } });
    fillNeed();
    fireEvent.change(screen.getByLabelText(/^Interventions/), { target: { value: "Shower chair\n\nHand-held shower" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for clinical review" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(rpcMock.calls).toHaveLength(1);
    const { fn, args } = rpcMock.calls[0];
    expect(fn).toBe("create_care_plan_revision_review");
    expect(args.p_previous_id).toBeNull();
    expect(args.p_resident_id).toBe("res-1");
    expect(args.p_effective).toBe("2026-09-16");
    expect(args.p_review).toBe("2027-09-16");
    expect(args.p_items).toEqual([
      expect.objectContaining({ category: "bathing", title: "Bathing", interventions: ["Shower chair", "Hand-held shower"] }),
    ]);
  });

  it("keeps every entered value when the save fails", async () => {
    rpcMock.error = "A revision is already awaiting clinical review";
    renderRevision();
    fireEvent.click(screen.getByRole("button", { name: "Revise care plan" }));
    fireEvent.change(screen.getByLabelText(/Effective date/), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText(/Review due/), { target: { value: "2027-09-16" } });
    fireEvent.change(screen.getByLabelText(/Reason for revision/), { target: { value: "Fall on 9/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for clinical review" }));
    expect(await screen.findByText(/A revision is already awaiting clinical review/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason for revision/)).toHaveValue("Fall on 9/1");
    expect(screen.getByLabelText(/Effective date/)).toHaveValue("2026-09-16");
    expect(screen.getAllByLabelText(/^Need title/)[0]).toHaveValue("Bathing");
    expect(rpcMock.calls[0].args.p_previous_id).toBe("plan-2");
  });

  it("makes removal recoverable and reports it in the change summary", () => {
    renderRevision();
    fireEvent.click(screen.getByRole("button", { name: "Revise care plan" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from this revision" })[1]);
    expect(screen.getByRole("status")).toHaveTextContent("Removed Dressing from this revision. The current plan is unchanged until this version is signed.");
    expect(screen.getByText(/1 removed/)).toBeInTheDocument();
    expect(screen.getByText("Changes in this revision")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove from this revision" })).toHaveLength(2);
    expect(screen.getByText("No needs changed yet", { exact: false })).toBeInTheDocument();
  });

  it("discards an untouched blank need without offering undo", () => {
    renderFirst();
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Add another need" }));
    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[1]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(1);
  });

  it("collapses a need to its summary line and back", () => {
    renderRevision();
    fireEvent.click(screen.getByRole("button", { name: "Revise care plan" }));
    const toggle = screen.getByRole("button", { name: "Need 1 · Bathing · Bathing · Limited assist" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByLabelText(/^Need title/)).toHaveLength(1);
    fireEvent.click(toggle);
    expect(screen.getAllByLabelText(/^Need title/)).toHaveLength(2);
  });

  it("guards leaving the page only while there are unsaved entries", async () => {
    renderFirst();
    fireEvent.click(screen.getByRole("button", { name: "Start care plan" }));
    expect(guardMock.guards).toHaveLength(1);
    expect(guardMock.guards[0]()).toBe(true);
    fireEvent.change(screen.getByLabelText(/Effective date/), { target: { value: "2026-09-16" } });
    await waitFor(() => expect(guardMock.guards[0]()).toBe(false));
    expect(window.confirm).toHaveBeenCalled();
    expect(guardMock.guards[0](true)).toBe(false);
  });
});
