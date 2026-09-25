import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BenefitsDetail } from "@/lib/benefits/contracts";
import { DocumentFreshness, freshnessLabel } from "./DocumentFreshness";

const caseId = "22222222-2222-4222-8222-222222222222";
const detail = { case: { id: caseId, revision: 5 } } as unknown as BenefitsDetail;
const item = (over: Record<string, unknown>) => ({ requirement_id: "44444444-4444-4444-8444-444444444444", title: "Bank statements", signature_status: "not_required", accepted_on: "2026-06-26", valid_days: 90, expires_on: "2026-09-24", days_left: 0, freshness: "expired", ...over });
const reply = (over: Record<string, unknown> = {}) => ({ as_of: "2026-09-24", case_id: caseId, revision: 5, can_write: true, family_can_collect: false, items: [item({})], ...over });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("document freshness", () => {
  it("labels expired, expiring and fresh documents", () => {
    expect(freshnessLabel({ freshness: "expired", expires_on: "2026-09-20", days_left: -4 })).toBe("Expired Sep 20, 2026");
    expect(freshnessLabel({ freshness: "expiring", expires_on: "2026-10-01", days_left: 7 })).toBe("Expires Oct 1, 2026 (7 days)");
    expect(freshnessLabel({ freshness: "fresh", expires_on: "2026-12-01", days_left: 68 })).toBe("Good until Dec 1, 2026");
  });
  it("renders nothing when no document has a period", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(reply({ items: [] }))));
    const { container } = render(<DocumentFreshness detail={detail} onChanged={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
  it("reopens an expired document with the case revision and says who gathers it", async () => {
    const onChanged = vi.fn();
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? json({ case_id: caseId, revision: 6 }) : json(reply()));
    vi.stubGlobal("fetch", fetch);
    render(<DocumentFreshness detail={detail} onChanged={onChanged} />);
    expect(await screen.findByText(/No linked family member has current financial access/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen to gather a current copy" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe(`/api/admin/benefits/cases/${caseId}/freshness`);
    expect(JSON.parse(post[1].body as string)).toMatchObject({ requirement_id: "44444444-4444-4444-8444-444444444444", expected_revision: 5 });
  });
  it("offers the family path only when a family member has current financial access, and no reopen for fresh documents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(reply({ family_can_collect: true, items: [item({ freshness: "expiring", days_left: 5, expires_on: "2026-09-29" }), item({ requirement_id: "55555555-5555-4555-8555-555555555555", title: "Bank statement savings", freshness: "fresh", days_left: 80, expires_on: "2026-12-13" })] }))));
    render(<DocumentFreshness detail={detail} onChanged={vi.fn()} />);
    expect(await screen.findByText(/linked family member with financial access can be asked/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Reopen to gather a current copy" })).toHaveLength(1);
  });
});
