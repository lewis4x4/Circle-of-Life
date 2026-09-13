import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFacilityProfile } from "@/lib/operations/facility-profile";
import Page from "./page";

const env = vi.hoisted(() => ({
  query: "facility_id=site-a", actor: "person-a", role: "owner", organization: "org-a", loading: false,
  replace: vi.fn(), facilities: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: env.replace }), useSearchParams: () => new URLSearchParams(env.query),
  usePathname: () => "/admin/operations/profile",
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({
  user: { id: env.actor }, appRole: env.role, organizationId: env.organization, fullName: "Dana", loading: env.loading,
}) }));
vi.mock("@/lib/admin-facilities", () => ({ fetchAdminFacilityOptions: () => env.facilities() }));
function reply(id = "site-a", name = "Example facility") {
  return buildFacilityProfile({ id, name, organization_id: "org-a", entity_id: "entity-a", entity_name: "Example entity", timezone: "America/New_York" }, [], []);
}
const ok = (body: unknown = reply()) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  env.query = "facility_id=site-a"; env.actor = "person-a"; env.role = "owner"; env.organization = "org-a"; env.loading = false;
  env.replace.mockClear();
  env.facilities.mockReset().mockResolvedValue([{ id: "site-a", name: "Example facility" }, { id: "site-b", name: "Second facility" }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
});

describe("Facility profile review", () => {
  it("preserves all source items and components, partial direction and unresolved authority", async () => {
    const body = reply();
    body.entries[0].components[0].fields.schedule = {
      status: "unknown", value: { frequency: "Weekly observation" }, reason: "Day and time need confirmation.",
      provenance: [{ source: "Owner clarification", answer_id: "Q05", approver_id: null, effective_from: null }],
    };
    vi.mocked(fetch).mockResolvedValue(ok(body) as Response);
    const { container } = render(<Page />);
    await screen.findByText("Source items: 91 · Checklist components: 110");
    expect(container.querySelectorAll("details")).toHaveLength(91);
    expect(screen.getByText("Approved rules: 0 · Rules needing confirmation: 110")).toBeVisible();
    const detail = container.querySelector("details")!; detail.open = true;
    expect(screen.getByText("frequency: Weekly observation")).toBeVisible();
    expect(screen.getByText("Day and time need confirmation.")).toBeVisible();
    expect(screen.getByText(/Source: Owner clarification · Recorded answer: Q05 · Recorded approver: Not recorded · Effective from: Not recorded/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish|approve/i })).not.toBeInTheDocument();
    expect(screen.getByText("Current person: Dana")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("facility_id=site-a"), expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("shows stored publication details as recorded claims rather than verified approval", async () => {
    const body=reply();
    body.entries[0].components[0].publication={requirement:{id:'version',version:2,source_authority:{answer:'Recorded <script>text</script>'},published_by:'publication-account',published_at:'2026-01-01T12:00:00Z',effective_from:'2026-02-01T00:00:00Z',effective_to:null},configuration:{id:'configuration',version:3,override_source:'interview',applicability_reason:'Recorded local scope',approved_by:'approval-account',approved_at:'2026-01-02T12:00:00Z',effective_from:'2026-02-01T00:00:00Z',effective_to:null}};
    body.summary.recorded_rule_count=1;
    vi.mocked(fetch).mockResolvedValue(ok(body) as Response);
    const {container}=render(<Page />);
    await screen.findByText("Source items: 91 · Checklist components: 110");
    container.querySelectorAll('details').forEach(detail=>{detail.open=true});
    expect(screen.getByText(/not independent verification of an operating rule/)).toBeVisible();
    expect(screen.getByText('Recorded publication actor: publication-account')).toBeVisible();
    expect(screen.getByText('Recorded approval actor: approval-account')).toBeVisible();
    expect(container.querySelector('pre')?.textContent).toContain('Recorded <script>text</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Approved rules: 0 · Rules needing confirmation: 110')).toBeVisible();
  });

  it("filters visible source rows without changing complete coverage counts", async () => {
    const { container } = render(<Page />);
    await screen.findByText("Showing 91 of 91 source items.");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "AL-W05" } });
    expect(screen.getByText("Showing 1 of 91 source items.")).toBeVisible();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent-source" } });
    expect(screen.getByText("No source items match these filters.")).toBeVisible();
    expect(screen.getByText("Source items: 91 · Checklist components: 110")).toBeVisible();
  });

  it("removes the old facility immediately and ignores its late response", async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(ok(reply("site-b", "Second profile")) as Response);
    const view = render(<Page />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    env.query = "facility_id=site-b"; view.rerender(<Page />);
    await screen.findByRole("heading", { name: "Second profile" });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(ok(reply("site-a", "Stale profile")) as Response));
    expect(screen.queryByText("Stale profile")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second profile" })).toBeVisible();
  });

  it("removes old profile information when the current person or role changes", async () => {
    const view = render(<Page />);
    await screen.findByText("Source items: 91 · Checklist components: 110");
    env.actor = "person-b"; env.facilities.mockReturnValue(new Promise(() => {}));
    view.rerender(<Page />);
    expect(screen.queryByText("Source items: 91 · Checklist components: 110")).not.toBeInTheDocument();
    expect(screen.getByText("Loading facilities…")).toBeVisible();
    env.role = "family"; view.rerender(<Page />);
    expect(screen.getByText("Facility profiles are unavailable for this person.")).toBeVisible();
    expect(env.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("separates inaccessible, failed and confirmed-empty facility reads", async () => {
    env.facilities.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<Page />);
    await screen.findByRole("alert");
    expect(screen.queryByText("No accessible facilities.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry facilities" }));
    await screen.findByText("No accessible facilities.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows revoked access without retaining counts and retries a failed request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response).mockResolvedValueOnce(ok() as Response);
    render(<Page />);
    await screen.findByText("This facility profile is no longer accessible.");
    expect(screen.queryByText(/Approved rules:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
    await screen.findByText("Source items: 91 · Checklist components: 110");
  });

  it.each(["incomplete", "wrong-facility"])("rejects a successful %s response", async kind => {
    const body = reply();
    if (kind === "incomplete") body.entries.pop();
    else body.facility.id = "site-b";
    vi.mocked(fetch).mockResolvedValue(ok(body) as Response);
    render(<Page />);
    await screen.findByText("The complete facility profile could not be confirmed. Retry the request.");
    expect(screen.queryByText(/Approved rules:/)).not.toBeInTheDocument();
  });

  it("keeps an unavailable URL facility out of the profile fetch", async () => {
    env.query = "facility_id=revoked-site";
    render(<Page />);
    await screen.findByText("The selected facility is no longer accessible. Choose an available facility.");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), { target: { value: "site-b" } });
    expect(env.replace).toHaveBeenCalledWith("/admin/operations/profile?facility_id=site-b", { scroll: false });
  });

  it("prepares drafts only with the server capability and waits for confirmation before reporting counts", async () => {
    const body = reply(); body.can_prepare_drafts = true;
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(ok(body) as Response)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(ok(body) as Response);
    render(<Page />);
    const button = await screen.findByRole("button", { name: "Prepare missing drafts" });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.queryByText(/Activity drafts prepared:/)).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/admin/operations/facility-profile/drafts", expect.objectContaining({
      method: "POST", body: JSON.stringify({ facility_id: "site-a" }), credentials: "same-origin",
    }));
    await act(async () => finish(ok({ prepared: 90, preserved: 9, unresolved: 11, results: Array.from({ length: 110 }, (_, n) => ({ activity_id: String(n) })) }) as Response));
    await screen.findByText("Activity drafts prepared: 90. Existing activities preserved: 9. Unresolved mappings: 11. Drafts still need attributable approval.");
    expect(screen.getByText("Approved rules: 0 · Rules needing confirmation: 110")).toBeVisible();
  });

  it("does not offer preparation without capability or claim success after a failed mutation", async () => {
    const body = reply(); body.can_prepare_drafts = true;
    vi.mocked(fetch).mockResolvedValueOnce(ok(body) as Response).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const view = render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare missing drafts" }));
    await screen.findByText("Draft preparation could not be confirmed. Retry preserves existing drafts and published versions.");
    expect(screen.queryByText(/Activity drafts prepared:/)).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(fetch).mockResolvedValue(ok() as Response);
    render(<Page />);
    await screen.findByText("Showing 91 of 91 source items.");
    expect(screen.queryByRole("button", { name: "Prepare missing drafts" })).not.toBeInTheDocument();
  });

  it("does not announce a preparation result that omits components", async () => {
    const body = reply(); body.can_prepare_drafts = true;
    vi.mocked(fetch).mockResolvedValueOnce(ok(body) as Response)
      .mockResolvedValueOnce(ok({ prepared: 1, preserved: 0, unresolved: 0, results: [{}] }) as Response);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare missing drafts" }));
    await screen.findByText("Draft preparation could not be confirmed. Retry preserves existing drafts and published versions.");
    expect(screen.queryByText(/Activity drafts prepared:/)).not.toBeInTheDocument();
  });

  it("keeps a confirmed preparation receipt visible if the following profile refresh fails", async () => {
    const body = reply(); body.can_prepare_drafts = true;
    vi.mocked(fetch).mockResolvedValueOnce(ok(body) as Response)
      .mockResolvedValueOnce(ok({ prepared: 0, preserved: 99, unresolved: 11, results: Array.from({ length: 110 }, () => ({})) }) as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare missing drafts" }));
    await screen.findByText("Facility profile unavailable. Coverage has not been confirmed.");
    expect(screen.getByText("Activity drafts prepared: 0. Existing activities preserved: 99. Unresolved mappings: 11. Drafts still need attributable approval.")).toBeVisible();
    expect(screen.queryByText("Source items: 91 · Checklist components: 110")).not.toBeInTheDocument();
  });

  it("abandons the previous person's pending draft response", async () => {
    const body = reply(); body.can_prepare_drafts = true;
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(ok(body) as Response)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare missing drafts" }));
    const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    env.actor = "other-person"; env.facilities.mockResolvedValueOnce([]); view.rerender(<Page />);
    await screen.findByText("No accessible facilities.");
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(ok({ prepared: 110, preserved: 0, unresolved: 0 }) as Response));
    expect(screen.queryByText(/Activity drafts prepared:/)).not.toBeInTheDocument();
  });

  it("has accessible controls and source details", async () => {
    const { container } = render(<main><Page /></main>);
    await screen.findByText("Source items: 91 · Checklist components: 110");
    container.querySelector("details")!.open = true;
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
