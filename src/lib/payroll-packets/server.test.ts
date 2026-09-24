import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentApiActor } from "@/lib/auth/current-api-actor";
import type { PacketSnapshot, PayrollPacket } from "./types";

const state = vi.hoisted(() => ({ allowed: true, revision: "1", packet: {} as PayrollPacket, snapshot: {} as PacketSnapshot, sourceName: "Test facility", artifact: {} as Record<string, string>, rpc: vi.fn(), renderPdf: vi.fn(), renderHtml: vi.fn(), renderCsv: vi.fn(), revalidate: vi.fn(), artifactRead: vi.fn() }));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({ serviceRoleUserHasFacilityAccess: () => Promise.resolve(state.allowed) }));
vi.mock("@/lib/auth/current-api-actor", () => ({ revalidateCurrentApiActor: state.revalidate }));
vi.mock("./compute", () => ({ buildPayrollSnapshot: (source: { sourceRevision: string }) => ({ ...structuredClone(state.snapshot), facilityName: state.sourceName, sourceRevision: source.sourceRevision, generatedAt: new Date().toISOString() }) }));
vi.mock("./documents", () => ({ buildPayrollPacketPdf: state.renderPdf, buildPayrollPacketHtml: state.renderHtml, buildPayrollPacketCsv: state.renderCsv }));
import { actOnPayrollPacket, getPayrollPacket, loadPayrollSource, payrollDocument, snapshotFingerprint } from "./server";

const facility = "11111111-1111-4111-8111-111111111111", staff = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
function client() {
  return { rpc: state.rpc, from: (table: string) => {
    let fields = "";
    const result = () => ({ data: table === "facilities" ? { id: facility, name: "Test facility" } : table === "payroll_packet_policies" ? null : state.packet, error: null });
    const q = {
      select: (value: string) => { fields = value; return q; }, eq: () => q, is: () => q, in: () => q, order: () => q,
      maybeSingle: async () => result(),
      single: async () => { if (fields.includes("approved_pdf_base64")) { state.artifactRead(); return { data: state.artifact, error: null }; } return result(); },
      range: async () => ({ data: [], count: 0, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  } };
}
const actor = () => ({ id: "44444444-4444-4444-8444-444444444444", organizationId: "55555555-5555-4555-8555-555555555555", appRole: "owner", fullName: "Payroll reviewer", admin: client() }) as unknown as CurrentApiActor;
beforeEach(() => {
  vi.clearAllMocks(); state.allowed = true; state.revision = "1"; state.sourceName = "Test facility";
  state.snapshot = { schemaVersion: 1, facilityId: facility, facilityName: "Test facility", employerName: "Test employer", periodStart: "2026-09-14", periodEnd: "2026-09-20", checkDate: "2026-09-25", generatedAt: "2026-09-21T00:00:00Z", sourceRevision: "1", policy: null, policyConfirmedAt: null, rows: [], totals: { regularMinutes: 0, overtimeMinutes: 0, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, paidMinutes: 0, workedMinutes: null, onCallCents: 0, bonusCents: 0, salaryCents: 0 }, blockers: [], warnings: [] };
  state.packet = { id, root_id: id, amends_packet_id: null, version: 1, revision: 1, organization_id: actor().organizationId, facility_id: facility, period_start: "2026-09-14", period_end: "2026-09-20", check_date: "2026-09-25", status: "draft", inputs: [], snapshot: structuredClone(state.snapshot), source_revision: "1", policy_revision: 0, created_at: "2026-09-21T00:00:00Z", created_by: actor().id, updated_at: "2026-09-21T00:00:00Z", approved_at: null, approved_by: null, approved_by_name: null, document_hash: null, reported_at: null, reported_by: null, report_method: null, report_reference: null, reconciled_at: null, reconciled_by: null, reconciliation_note: null, amendment_reason: null };
  state.renderPdf.mockReturnValue(Buffer.from("%PDF-1.4\nrendered")); state.renderHtml.mockReturnValue("<html>rendered</html>"); state.renderCsv.mockReturnValue("name,hours\nExample,1\n");
  const bytes = Buffer.from("%PDF-1.4\nfrozen");
  state.artifact = { approved_pdf_base64: bytes.toString("base64"), approved_html: "<html>frozen</html>", approved_csv: "frozen,csv\n", document_hash: createHash("sha256").update(bytes).digest("hex") };
  state.revalidate.mockImplementation(async (current: CurrentApiActor) => ({ actor: current }));
  state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "payroll_packet_revision") return { data: state.revision, error: null };
    if (name === "payroll_packet_source_page") return { data: { data: args.p_kind === "people" ? [{ id: staff, name: "Test employee", facilityId: facility, role: "resident_aide", employmentStatus: "active", userId: null, employeeNumber: "A1" }] : [], count: args.p_kind === "people" ? 1 : 0 }, error: null };
    if (name === "payroll_packet_write") { state.packet = { ...state.packet, revision: state.packet.revision + 1, snapshot: args.p_snapshot as PacketSnapshot, source_revision: String(args.p_source_revision) }; return { data: state.packet, error: null }; }
    return { data: state.packet, error: null };
  });
});
describe("payroll packet server boundaries", () => {
  it("refuses another facility before reading document bytes", async () => {
    state.allowed = false;
    await expect(payrollDocument(actor(), id, "pdf")).rejects.toMatchObject({ status: 404 });
    expect(state.artifactRead).not.toHaveBeenCalled(); expect(state.renderPdf).not.toHaveBeenCalled();
  });
  it("redownloads every approved format from frozen bytes rather than the current renderer", async () => {
    state.packet.status = "reported";
    expect((await payrollDocument(actor(), id, "pdf")).body.toString()).toBe("%PDF-1.4\nfrozen");
    expect((await payrollDocument(actor(), id, "html")).body).toBe("<html>frozen</html>");
    expect((await payrollDocument(actor(), id, "csv")).body).toBe("frozen,csv\n");
    expect(state.renderPdf).not.toHaveBeenCalled(); expect(state.renderHtml).not.toHaveBeenCalled(); expect(state.renderCsv).not.toHaveBeenCalled();
  });
  it("fails a corrupt or missing approved artifact without regenerating it", async () => {
    state.packet.status = "approved"; state.artifact.document_hash = "0".repeat(64);
    await expect(payrollDocument(actor(), id, "pdf")).rejects.toMatchObject({ status: 503 });
    expect(state.renderPdf).not.toHaveBeenCalled();
  });
  it("revalidates the account before allowing a file download", async () => {
    state.revalidate.mockResolvedValue({ response: {} });
    await expect(payrollDocument(actor(), id, "pdf")).rejects.toMatchObject({ status: 401 });
    expect(state.renderPdf).not.toHaveBeenCalled();
  });
  it("does not assemble a source while its revision changes", async () => {
    let revisions = 0;
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "payroll_packet_revision" ? { data: String(++revisions), error: null } : original(name, args));
    await expect(loadPayrollSource(actor(), facility)).rejects.toThrow("changed while loading");
  });
  it("rejects incomplete source pagination instead of silently making a partial packet", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "payroll_packet_source_page" && args.p_kind === "punches" ? { data: { data: [], count: 2 }, error: null } : original(name, args));
    await expect(loadPayrollSource(actor(), facility)).rejects.toThrow("changed while loading");
  });
  it("rejects a business-source change before rendering or approving", async () => {
    state.sourceName = "Changed facility";
    await expect(actOnPayrollPacket(actor(), id, { action: "approve", expectedRevision: 1 })).rejects.toThrow("source timecards or payroll rules changed");
    expect(state.renderPdf).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.some(([name]) => name === "payroll_packet_action")).toBe(false);
  });
  it("refreshes only an unrelated revision change before atomically approving", async () => {
    state.revision = "2";
    await actOnPayrollPacket(actor(), id, { action: "approve", expectedRevision: 1 });
    expect(state.rpc).toHaveBeenCalledWith("payroll_packet_write", expect.objectContaining({ p_expected_revision: 1, p_source_revision: "2" }));
    expect(state.rpc).toHaveBeenCalledWith("payroll_packet_action", expect.objectContaining({ p_actor_id: actor().id, p_expected_revision: 2, p_detail: expect.objectContaining({ approvedByName: "Payroll reviewer", csv: "name,hours\nExample,1\n" }) }));
  });
  it.each(["hours", "policy", "revision-only"] as const)("binds saved review marks to the reviewed source: %s", async (change) => {
    const reviewed = { staffId: staff, payrollId: "A1", payBasis: "hourly" as const, department: "operations" as const, regularMinutes: 2400, overtimeMinutes: 0, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, onCallCents: 0, bonusCents: 0, salaryCents: null, note: "", reason: "Reviewed allocation", reviewed: true };
    state.packet.inputs = [reviewed];
    state.revision = "2";
    if (change === "hours") state.snapshot.totals.regularMinutes += 60;
    if (change === "policy") state.snapshot.policyConfirmedAt = "2026-09-24T18:00:00Z";
    await actOnPayrollPacket(actor(), id, { action: "save", expectedRevision: 1, inputs: [{ ...reviewed, note: "Updated call notes", bonusCents: 1000 }], checkDate: "2026-09-26" });
    expect(state.rpc).toHaveBeenCalledWith("payroll_packet_write", expect.objectContaining({
      p_source_revision: "2", p_check_date: "2026-09-26",
      p_inputs: [expect.objectContaining({ note: "Updated call notes", bonusCents: 1000, reviewed: change === "revision-only" })],
    }));
  });
  it("keeps amendment identity while correcting its draft check date", async () => {
    state.packet.amends_packet_id = "66666666-6666-4666-8666-666666666666";
    await actOnPayrollPacket(actor(), id, { action: "save", expectedRevision: 1, inputs: [], checkDate: "2026-09-26" });
    expect(state.rpc).toHaveBeenCalledWith("payroll_packet_write", expect.objectContaining({ p_amends_packet_id: state.packet.amends_packet_id, p_check_date: "2026-09-26" }));
  });
  it("exposes safe, useful refusal text for stale database approval", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "payroll_source_stale" } });
    await expect(actOnPayrollPacket(actor(), id, { action: "report", expectedRevision: 1, method: "phone", reference: "Call reference" })).rejects.toMatchObject({ message: "Time records changed. Refresh and review the draft before approving.", status: 409 });
  });
  it("ignores transport revisions in the content fingerprint but detects changed pay", () => {
    expect(snapshotFingerprint({ ...state.snapshot, generatedAt: "later", sourceRevision: "999" })).toBe(snapshotFingerprint(state.snapshot));
    expect(snapshotFingerprint({ ...state.snapshot, totals: { ...state.snapshot.totals, bonusCents: 100 } })).not.toBe(snapshotFingerprint(state.snapshot));
  });
  it("does not use a caller's optimistic revision after another editor saves", async () => {
    await expect(actOnPayrollPacket(actor(), id, { action: "refresh", expectedRevision: 9 })).rejects.toThrow("packet changed");
    expect(state.rpc).not.toHaveBeenCalled();
    expect((await getPayrollPacket(actor(), id)).id).toBe(id);
  });
});
