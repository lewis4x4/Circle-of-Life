import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
const m = vi.hoisted(() => ({
  batch: { id: "batch", organization_id: "org", facility_id: "00000000-0000-4000-8000-00000000fac1", status: "draft", period_start: "2090-01-01", period_end: "2090-01-31", provider: "generic", updated_at: "2090-01-01T00:00:00Z" },
  lines: [{ id: "line", line_kind: "time_record_hours", amount_cents: null, idempotency_key: "time_record:punch", payload: { actual_hours: 8, regular_hours: 8, overtime_hours: 0 }, staff: { first_name: "Payroll", last_name: "Employee" } }],
  rpc: vi.fn(), download: vi.fn(), refresh: vi.fn(), client: {} as Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "batch" }), useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: "actor" } }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: m.batch.facility_id }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => m.client }));
vi.mock("@/lib/csv-export", async (original) => ({ ...await original<object>(), triggerCsvDownload: m.download }));
beforeEach(() => {
  m.batch.status = "draft"; m.rpc.mockReset(); m.download.mockReset();
  m.client = { rpc: m.rpc, from: (table: string) => {
    const result = table === "payroll_export_batches" ? m.batch : table === "payroll_export_lines" ? m.lines : [];
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "gte", "lte", "order"]) q[method] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: result, error: null });
    q.range = () => Promise.resolve({ data: result, count: Array.isArray(result) ? result.length : 1, error: null });
    return q;
  }};
});
describe("payroll freshness recovery", () => {
  it("refreshes existing lines even with no new eligible punches and exposes retry after failure", async () => {
    m.rpc.mockResolvedValueOnce({ error: { message: "Source changed; retry refresh" } })
      .mockResolvedValueOnce({ data: { added: 0, refreshed: 1, other_batch: 0, needs_review: 0 }, error: null });
    render(<Page />);
    const button = await screen.findByRole("button", { name: "Refresh approved punches" });
    expect(button).toBeEnabled(); fireEvent.click(button);
    expect(await screen.findByText("Source changed; retry refresh")).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText(/0 added; 1 refreshed/)).toBeInTheDocument();
    expect(m.rpc).toHaveBeenCalledWith("refresh_payroll_time_records", { p_batch_id: "batch", p_expected_actor: "actor" });
  });
  it.each(["CSV (full)", "CSV (flat)", "CSV (vendor handoff)", "CSV (hours split)"])("blocks stale %s and downloads only after a fresh retry", async (label) => {
    m.rpc.mockResolvedValueOnce({ error: { message: "Payroll punches changed. Refresh approved punches." } })
      .mockResolvedValueOnce({ data: { batch: m.batch, lines: m.lines, line_count: 1 }, error: null });
    render(<Page />);
    const button = await screen.findByRole("button", { name: label });
    fireEvent.click(button);
    expect(await screen.findByText(/Payroll punches changed/)).toBeInTheDocument(); expect(m.download).not.toHaveBeenCalled();
    fireEvent.click(button); await waitFor(() => expect(m.download).toHaveBeenCalledTimes(1));
  });
  it("provides explicit ineligible exclusion and reports retained evidence", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null }); render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Exclude ineligible punch from draft" }));
    expect(await screen.findByText(/prior line evidence and global ownership are retained/)).toBeInTheDocument();
    expect(m.rpc).toHaveBeenCalledWith("exclude_payroll_draft_punch", { p_batch_id: "batch", p_line_id: "line", p_expected_actor: "actor" });
  });
  it("labels exported evidence and provides downloads without draft mutations", async () => {
    m.batch.status = "exported"; render(<Page />);
    expect(await screen.findByText(/Historical exported batch/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh approved punches" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exclude ineligible punch from draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CSV (flat)" })).toBeEnabled();
  });
});
