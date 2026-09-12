import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { TaskHelpHandover } from "./task-help-handover";

const props = { activityId: "activity", facilityId: "facility", occurrenceId: "occurrence", actorId: "actor", timezone: "America/New_York" };
const duty = { proposal_id: "proposal", duty_scope: "Weekly filing", owner_user_id: "actor", backup_user_id: "other", effective_at: "2026-09-11T12:00:00Z", owner_accepted_at: null, backup_accepted_at: null, active: false, owner_current: true, backup_current: true, covered: false, latest_event_id: "event" };
const snapshot = () => ({ actor_id: "actor", activity_id: "activity", facility_id: "facility", can_publish: true, can_assign: true, people: [{ id: "actor", name: "Alex" }, { id: "other", name: "Blair" }], help: null, help_history: [], duty_history: [], current_duties: [], open_issues: [], open_occurrences: [], governing_requirement: null, governing_facility_requirement: null });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
async function open() {
  await userEvent.click(screen.getByText("Task help and handover"));
  await screen.findByText("Current supplemental guidance");
}
describe("optional task help and handover", () => {
  it("does not fetch or require acknowledgement until disclosed, preserves Unknown rules, and is accessible", async () => {
    fetchMock.mockResolvedValue(response(snapshot()));
    const { container } = render(<TaskHelpHandover {...props} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await open();
    expect(screen.getByText(/Local duty and absence-cover arrangements/)).toBeVisible();
    expect(screen.getByText(/No supplemental local duty proposals recorded/)).toBeVisible();
    expect(screen.getByText(/complete routine work without opening/)).toBeVisible();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });
  it("offers only the current recipient's acceptance and sends the current revision", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...snapshot(), can_assign: false, can_publish: false, current_duties: [duty] })).mockResolvedValueOnce(response({ event: { id: "accepted", actor_id: "actor", command: "accept" } })).mockResolvedValue(response(snapshot()));
    render(<TaskHelpHandover {...props} />); await open();
    expect(screen.queryByRole("button", { name: /Accept backup/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept owner duty: Weekly filing" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ command: "accept", expected_id: "event", activity_id: "activity", facility_id: "facility", payload: { proposal_id: "proposal", duty_role: "owner" } });
  });
  it("retries a lost reply byte-for-byte and prevents a different mutation while unresolved", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...snapshot(), current_duties: [duty] })).mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce(response({ event: { id: "accepted", actor_id: "actor", command: "accept" } })).mockResolvedValue(response(snapshot()));
    render(<TaskHelpHandover {...props} />); await open();
    await userEvent.click(screen.getByRole("button", { name: "Accept owner duty: Weekly filing" }));
    await screen.findByText(/save result is unknown/);
    expect(screen.getByRole("button", { name: "Accept owner duty: Weekly filing" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
  });
  it("keeps malformed success replies unresolved", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...snapshot(), current_duties: [duty] })).mockResolvedValueOnce(response({}));
    render(<TaskHelpHandover {...props} />); await open();
    await userEvent.click(screen.getByRole("button", { name: "Accept owner duty: Weekly filing" }));
    await screen.findByText(/save result is unknown/);
    expect(screen.queryByText(/Saved. Current details/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry same change" })).toBeEnabled();
  });
  it("publishes a full guidance revision with a current prior version and separates governing instructions", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...snapshot(), governing_requirement: { id: "rule-1", title: "Pinned rule", procedure: "Retain the original procedure" }, help: { id: "help-1", actor_id: "actor", created_at: "2026-09-11T12:00:00Z", command: "help", payload: { how_to: "Current advice", protected_documents: [] } } })).mockResolvedValueOnce(response({ event: { id: "help-2", actor_id: "actor", command: "help" } })).mockResolvedValue(response(snapshot()));
    render(<TaskHelpHandover {...props} />); await open();
    expect(screen.getByText(/Retain the original procedure/)).toBeVisible();
    expect(screen.getByText(/How to: Current advice/)).toBeVisible();
    await userEvent.click(screen.getByText("Publish supplemental help"));
    await userEvent.type(screen.getByLabelText("How to"), "Use the checklist");
    await userEvent.click(screen.getByRole("button", { name: "Publish help" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ command: "help", expected_id: "help-1", payload: { how_to: "Use the checklist" } });
    expect(body.payload).not.toHaveProperty("protected_document_ids");
  });
  it("shows departed ownership as uncovered and preserves authorized historical document links", async () => {
    fetchMock.mockResolvedValue(response({ ...snapshot(), current_duties: [{ ...duty, active: true, owner_accepted_at: "2026-09-10T12:00:00Z", owner_current: false }], help_history: [{ id: "old-help", command: "help", actor_id: "actor", created_at: "2026-09-10T12:00:00Z", payload: { how_to: "Earlier guidance", protected_documents: [{ id: "doc", label: "Approved checklist", href: "/admin/facilities/facility/documents" }, { id: "bad", label: "Unavailable reference", href: "https://untrusted.example" }] } }] }));
    render(<TaskHelpHandover {...props} />); await open();
    expect(screen.getByText(/Uncovered — a replacement/)).toBeVisible();
    await userEvent.click(screen.getByText("Guidance history"));
    expect(screen.getByRole("link", { name: "Approved checklist" })).toHaveAttribute("href", "/admin/facilities/facility/documents");
    expect(screen.queryByRole("link", { name: "Unavailable reference" })).not.toBeInTheDocument();
  });
  it("does not offer acceptance of an obsolete proposal", async () => {
    fetchMock.mockResolvedValue(response({ ...snapshot(), current_duties: [duty, { ...duty, proposal_id: "replacement", owner_user_id: "other", backup_user_id: null }] }));
    render(<TaskHelpHandover {...props} />); await open();
    expect(screen.getByText(/Superseded proposal/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Accept owner duty/ })).not.toBeInTheDocument();
  });
  it("shows pinned configured owners without claiming personal acceptance or current coverage", async () => {
    fetchMock.mockResolvedValue(response({ ...snapshot(), governing_facility_requirement: { id: "pinned", owner_role: "administrator", owner_user_id: "actor", backup_role: "manager", backup_user_id: "departed", effective_from: "2026-09-01T12:00:00Z", effective_to: "2026-09-10T12:00:00Z" } }));
    render(<TaskHelpHandover {...props} />); await open();
    expect(screen.getByText("Ownership recorded in this task’s rule version")).toBeVisible();
    expect(screen.getByText(/Configured owner role: administrator · Person: Alex/)).toBeVisible();
    expect(screen.getByText(/Configured backup role: manager · Person: Person unavailable/)).toBeVisible();
    expect(screen.getByText(/Rule effective from: Sep 1, 2026/)).toBeVisible();
    expect(screen.getByText(/does not establish personal acceptance or current coverage/)).toBeVisible();
    expect(screen.getByText(/No supplemental local duty proposals recorded. Personal acceptance is unknown/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Accept.*duty/ })).not.toBeInTheDocument();
  });
  it("hides data for a mismatched current actor and for revoked read access", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...snapshot(), actor_id: "someone-else" })).mockResolvedValueOnce(response({ error: "Forbidden" }, 403));
    render(<TaskHelpHandover {...props} />);
    await userEvent.click(screen.getByText("Task help and handover"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Current supplemental guidance")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh task help" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Publish supplemental help")).not.toBeInTheDocument();
  });
  it("does not apply an old scope response after the person changes", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<TaskHelpHandover {...props} />);
    await userEvent.click(screen.getByText("Task help and handover"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<TaskHelpHandover {...props} actorId="new-actor" />);
    await act(async () => finish(response(snapshot())));
    expect(screen.queryByText("Current supplemental guidance")).not.toBeInTheDocument();
  });
});
