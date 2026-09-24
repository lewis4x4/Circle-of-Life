import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedicaidRechecksHomeCard, MedicaidRechecksPanel, recheckReason } from "./MedicaidRechecks";

const facilityId = "11111111-1111-4111-8111-111111111111";
const row = {
  id: "22222222-2222-4222-8222-222222222222", facility_id: facilityId, facility_name: "Anon Facility", resident_id: "33333333-3333-4333-8333-333333333333",
  resident_name: "Anon Resident", due_on: "2026-09-20", overdue: true, can_write: true, last_answered_at: "2026-06-22T14:00:00Z",
  last_result: "not_qualified_now", last_reasons: [], q_property_non_primary: "yes", q_income_over_limit: "no", q_assets: "no",
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("Medicaid rechecks", () => {
  it("says why the resident did not qualify last time", () => {
    expect(recheckReason(row as never)).toBe("Last answers: property other than home");
  });
  it("home card stays silent without Medicaid access and when nothing is due", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "Benefits case or access is unavailable." }, 404)));
    const { container, unmount } = render(<MedicaidRechecksHomeCard facilityId={facilityId} />);
    await waitFor(() => expect(container.textContent).toBe(""));
    unmount();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ as_of: "2026-09-24", rechecks: [] })));
    const second = render(<MedicaidRechecksHomeCard facilityId={facilityId} />);
    await waitFor(() => expect(second.container.textContent).toBe(""));
  });
  it("home card shows overdue rechecks and links to the facility's recheck list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ as_of: "2026-09-24", rechecks: [row] })));
    render(<MedicaidRechecksHomeCard facilityId={facilityId} />);
    expect(await screen.findByText("1 overdue")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ask the Medicaid questions again/ })).toHaveProperty("href", expect.stringContaining(`view=rechecks&facility_id=${facilityId}`));
  });
  it("records no change with the recheck's request identity and reloads", async () => {
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ recheck_id: row.id, outcome: "no_change", next_recheck_id: row.id, next_due_on: "2026-12-23" }) : json({ as_of: "2026-09-24", rechecks: [row] }));
    vi.stubGlobal("fetch", fetch);
    render(<MedicaidRechecksPanel facilityId={facilityId} />);
    fireEvent.click(await screen.findByRole("button", { name: "No change" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm no change" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => !init?.method || init.method === "GET").length).toBe(2));
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe(`/api/admin/benefits/rechecks/${row.id}/complete`);
    expect(JSON.parse(post[1].body as string)).toMatchObject({ outcome: "no_change", note: null });
  });
  it("tells staff without access who can grant it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "no" }, 404)));
    render(<MedicaidRechecksPanel />);
    expect(await screen.findByText(/visible to staff with Medicaid access/)).toBeTruthy();
  });
});
