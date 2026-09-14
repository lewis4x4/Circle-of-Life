import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: vi.fn() }));
vi.mock("@/lib/system-alerts/server", async (original) => ({ ...await original<typeof import("@/lib/system-alerts/server")>(), alertRpc: vi.fn(), deliverTest: vi.fn() }));
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { alertRpc, deliverTest } from "@/lib/system-alerts/server";
import { GET, PATCH } from "./route";
import { POST } from "./test/route";
const request = (body: unknown) => new NextRequest("https://haven.example/api/admin/settings/system-alerts", { method: "PATCH", body: JSON.stringify(body) });
const config = { expectedVersion: 0, enabled: true, recipients: ["admin@example.invalid"], alertKinds: ["job_failure"] };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireAdminApiActor).mockResolvedValue({ actor: {} } as never); vi.mocked(alertRpc).mockResolvedValue({ data: {}, error: null }); });
describe("system alerts API boundaries", () => {
 it("refuses every endpoint before reading settings or sending mail", async () => {
  vi.mocked(requireAdminApiActor).mockResolvedValue({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
  expect((await GET()).status).toBe(403); expect((await PATCH(request(config))).status).toBe(403); expect((await POST(request({ expectedVersion: 1 }))).status).toBe(403);
  expect(alertRpc).not.toHaveBeenCalled(); expect(deliverTest).not.toHaveBeenCalled();
 });
 it("uses current authenticated RPC and normalizes recipients", async () => {
  await PATCH(request({ ...config, recipients: [" ADMIN@example.invalid "] }));
  expect(requireAdminApiActor).toHaveBeenCalledWith({ allowedRoles: ["owner", "org_admin"] });
  expect(alertRpc).toHaveBeenCalledWith("system_alert_settings_update", { p_expected_version: 0, p_enabled: true, p_recipients: ["admin@example.invalid"], p_alert_kinds: ["job_failure"] });
 });
 it("rejects duplicate recipients, injected scope and empty enabled config", async () => {
  for (const bad of [{ ...config, recipients: [] }, { ...config, organization_id: "other" }, { ...config, recipients: ["admin@example.invalid", "ADMIN@example.invalid"] }]) expect((await PATCH(request(bad))).status).toBe(422);
  expect(alertRpc).not.toHaveBeenCalled();
 });
 it("returns revision conflict instead of overwriting and does not send", async () => {
  vi.mocked(alertRpc).mockResolvedValue({ data: null, error: { code: "40001" } });
  expect((await PATCH(request(config))).status).toBe(409);expect((await POST(request({ expectedVersion: 1 }))).status).toBe(409);expect(deliverTest).not.toHaveBeenCalled();
 });
 it("only explicit POST sends the queued test", async () => {
  vi.mocked(alertRpc).mockResolvedValue({ data: { id: "test-id" }, error: null });
  vi.mocked(deliverTest).mockResolvedValue(NextResponse.json({ status: "provider_accepted" }));
  await POST(request({ expectedVersion: 1 }));expect(deliverTest).toHaveBeenCalledWith("test-id");
 });
});
