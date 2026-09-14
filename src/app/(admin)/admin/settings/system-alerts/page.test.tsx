import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemAlertsPage from "./page";

const auth = vi.hoisted(() => ({ appRole: "owner", organizationId: "org-a", loading: false }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
const settings = { version: 4, enabled: true, recipients: ["admin@example.test"], alertKinds: ["job_failure"] };
const overview = { settings, deliveries: [], jobs: [], audit: [], emailConfigured: true, monitoringConfigured: true };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.appRole = "owner";
  fetchMock = vi.fn().mockResolvedValue(response(overview));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("System alert settings", () => {
  it("does not request privileged data for a facility admin", () => {
    auth.appRole = "facility_admin";
    render(<SystemAlertsPage />);
    expect(screen.getByText(/Only owners and organization admins/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps unconfigured recipients empty without enabling test sending", async () => {
    fetchMock.mockResolvedValue(response({ ...overview, settings: { ...settings, recipients: [], enabled: false } }));
    render(<SystemAlertsPage />);
    expect(await screen.findByLabelText("Primary email")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send test email to saved recipients" })).toBeDisabled();
    expect(screen.getByText("No email attempts recorded yet.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves primary and backup recipients with the loaded version and never sends automatically", async () => {
    fetchMock.mockResolvedValueOnce(response(overview)).mockResolvedValueOnce(response({ settings: { ...settings, version: 5, recipients: ["admin@example.test", "backup@example.test"] } })).mockResolvedValueOnce(response({ ...overview, settings: { ...settings, version: 5, recipients: ["admin@example.test", "backup@example.test"] } }));
    render(<SystemAlertsPage />);
    fireEvent.change(await screen.findByLabelText("Backup emails (optional)"), { target: { value: "backup@example.test" } });
    expect(screen.getByRole("button", { name: "Send test email to saved recipients" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("System alert settings saved.");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/settings/system-alerts");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 4, enabled: true, recipients: ["admin@example.test", "backup@example.test"], alertKinds: ["job_failure"] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves stale edits and prevents sending until latest settings are loaded", async () => {
    fetchMock.mockResolvedValueOnce(response(overview)).mockResolvedValueOnce(response({ error: "stale" }, 409));
    render(<SystemAlertsPage />);
    fireEvent.change(await screen.findByLabelText("Primary email"), { target: { value: "changed@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByRole("button", { name: "Discard edits and reload latest settings" });
    expect(screen.getByLabelText("Primary email")).toHaveValue("changed@example.test");
    expect(screen.getByRole("button", { name: "Send test email to saved recipients" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires a deliberate test click and calls it accepted, not delivered", async () => {
    fetchMock.mockResolvedValueOnce(response(overview))
      .mockResolvedValueOnce(response({ status: "provider_accepted", id: "attempt" }))
      .mockResolvedValueOnce(response({ ...overview, deliveries: [{ id: "attempt", kind: "test", status: "provider_accepted", created_at: "2026-09-14T12:00:00Z", updated_at: "2026-09-14T12:00:00Z", error_code: null }] }));
    render(<SystemAlertsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Send test email to saved recipients" }));
    await screen.findByText(/Test email accepted for sending/);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/settings/system-alerts/test");
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 4 });
    expect(screen.getByText("Accepted for sending — delivery not confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Delivered")).not.toBeInTheDocument();
  });

  it("shows missing setup without requiring a test email", async () => {
    fetchMock.mockResolvedValue(response({ ...overview, emailConfigured: false, monitoringConfigured: false }));
    render(<SystemAlertsPage />);
    await screen.findByText(/Email sending is not set up yet/);
    expect(screen.getByText(/Scheduled job monitoring is not activated/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test email to saved recipients" })).toBeDisabled();
  });

  it("shows administrator attribution without exposing identifiers and labels historical job results", async () => {
    fetchMock.mockResolvedValue(response({ ...overview, audit: [{ actor_id: "private-user-identifier", actor_name: null, changed_at: "2026-09-14T12:00:00Z", before_settings: null, after_settings: settings }], jobs: [{ jobid: 1, jobname: "Daily scheduled summary", state: "success", checked_at: "2026-09-14T12:00:00Z" }] }));
    render(<SystemAlertsPage />);
    await screen.findByText("Changed by Administrator");
    expect(screen.queryByText(/private-user-identifier/)).not.toBeInTheDocument();
    expect(screen.getByText("Last run succeeded")).toBeInTheDocument();
    expect(screen.getByText("Scheduled job results")).toBeInTheDocument();
  });

  it("keeps failed saves editable and reports failure", async () => {
    fetchMock.mockResolvedValueOnce(response(overview)).mockResolvedValueOnce(response({ error: "failed" }, 500));
    render(<SystemAlertsPage />);
    fireEvent.change(await screen.findByLabelText("Primary email"), { target: { value: "changed@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Settings could not be saved"));
    expect(screen.getByLabelText("Primary email")).toHaveValue("changed@example.test");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });
});
