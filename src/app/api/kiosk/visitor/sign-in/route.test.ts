import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { validateKioskSignIn } from "@/lib/kiosk/contract";

import { POST } from "./route";

const ENTRY = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, token: string | null = "kiosk-token"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/kiosk/visitor/sign-in", { method: "POST", headers, body: JSON.stringify(body) });
}

const VISIT = { kind: "visitor", client_entry_id: ENTRY, name: " Jordan Visitor ", phone: "", visiting_name: "Test Resident", symptoms: false };

beforeEach(() => {
  vi.clearAllMocks();
  mock.rpc.mockResolvedValue({ data: { ok: true, replayed: false, entry_id: "e1", checked_in_at: "2026-09-23T14:12:00Z" }, error: null });
});

describe("POST /api/kiosk/visitor/sign-in", () => {
  it("signs a family visitor in with the kiosk token (no-store)", async () => {
    const response = await POST(request(VISIT));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ entry_id: "e1", checked_in_at: "2026-09-23T14:12:00Z" });
    expect(mock.rpc).toHaveBeenCalledWith("visitor_kiosk_sign_in", {
      p_device_token: "kiosk-token",
      p_client_entry_id: ENTRY,
      p_visitor_type: "family_friend",
      p_visitor_name: "Jordan Visitor",
      p_visitor_phone: null,
      p_visitor_company: null,
      p_visiting_name_text: "Test Resident",
      p_purpose: null,
      p_symptoms_reported: false,
    });
  });

  it("maps each kind to its visitor_type and passes a reported symptom", async () => {
    await POST(request({ kind: "provider", client_entry_id: ENTRY, name: "Pat Provider", company: "Synthetic Home Health", symptoms: true }));
    expect(mock.rpc.mock.calls[0]?.[1]).toMatchObject({ p_visitor_type: "healthcare_provider", p_visitor_company: "Synthetic Home Health", p_symptoms_reported: true });
    await POST(request({ kind: "vendor", client_entry_id: ENTRY, name: "Val Vendor", company: "Synthetic Supply", purpose: "Delivery" }));
    expect(mock.rpc.mock.calls[1]?.[1]).toMatchObject({ p_visitor_type: "vendor_contractor", p_purpose: "Delivery", p_symptoms_reported: false });
    await POST(request({ kind: "inspector", client_entry_id: ENTRY, name: "Ira Inspector", company: "State agency" }));
    expect(mock.rpc.mock.calls[2]?.[1]).toMatchObject({ p_visitor_type: "surveyor_regulator", p_visiting_name_text: null });
  });

  it("returns field errors per kind before the database", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...VISIT, visiting_name: "" }, "visiting_name"],
      [{ ...VISIT, symptoms: undefined }, "symptoms"],
      [{ kind: "vendor", client_entry_id: ENTRY, name: "Val Vendor" }, "company"],
      [{ kind: "inspector", client_entry_id: ENTRY, name: "Ira", company: "State", visiting_name: "Someone" }, "visiting_name"],
      [{ ...VISIT, phone: "call me" }, "phone"],
      [{ ...VISIT, name: "  " }, "name"],
    ];
    for (const [body, field] of cases) {
      const response = await POST(request(body));
      expect(response.status, field).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("invalid_input");
      expect(Object.keys(json.fields), field).toContain(field);
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("answers with the same words the kiosk screen shows, from the one contract", async () => {
    const response = await POST(request({ ...VISIT, visiting_name: "", symptoms: undefined }));
    const json = await response.json();
    const screen = validateKioskSignIn("visitor", { name: VISIT.name, phone: VISIT.phone, visiting_name: "", symptoms: null });
    expect(screen.ok).toBe(false);
    if (!screen.ok) expect(json.fields).toEqual(screen.errors);
    expect(json.fields).toMatchObject({ visiting_name: "Enter the name of the person you are visiting.", symptoms: "Choose Yes or No." });
  });

  it("refuses an unknown kind, a bad entry id and a missing token", async () => {
    expect((await POST(request({ ...VISIT, kind: "resident" }))).status).toBe(400);
    expect((await POST(request({ ...VISIT, client_entry_id: "x" }))).status).toBe(400);
    expect((await POST(request(VISIT, null))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps a floor or revoked token to 401 and a database error to 503 without its text", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_unknown" }, error: null });
    expect((await POST(request(VISIT))).status).toBe(401);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "secret detail", code: "XX000" } });
    const failed = await POST(request(VISIT));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "unavailable" });
  });
});
