import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { listReferralNextActions, saveRecoveryIdentifier, readRecoveryIdentifiers, removeRecoveryIdentifier, recoveryKey } from "./next-actions";
describe("referral action client", () => {
  it("preserves scoped keyset pagination and explicit closed-history choice", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
    await listReferralNextActions({ rpc } as unknown as SupabaseClient<Database>, "facility", { leadId: "lead", openOnly: false, cursor: { created_at: "time", id: "id" }, limit: 10 });
    expect(rpc).toHaveBeenCalledWith("haven_list_referral_next_actions", { p_facility_id: "facility", p_lead_id: "lead", p_open_only: false, p_before_created_at: "time", p_before_id: "id", p_limit: 10 });
  });
  it("stores only recovery identifiers even if passed extra data", () => {
    const scope = { user_id: "user", organization_id: "org", facility_id: "facility", lead_id: "lead", action_text: "private text" };
    const setItem = vi.fn(); saveRecoveryIdentifier({ setItem, getItem: () => null }, scope, "request", "action");
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual([{ user_id: "user", organization_id: "org", facility_id: "facility", lead_id: "lead", request_id: "request", action_id: "action" }]);
  });
  it("rejects a recovery record from a different actor", () => {
    const scope = { user_id: "user", organization_id: "org", facility_id: "facility", lead_id: "lead" };
    expect(() => readRecoveryIdentifiers({ getItem: () => JSON.stringify({ ...scope, user_id: "other", request_id: "request" }) }, scope)).toThrow();
    expect(recoveryKey(scope)).not.toEqual(recoveryKey({ ...scope, user_id: "other" }));
  });
  it("retains every uncertain ID until that specific receipt is confirmed", () => {
    const scope = { user_id: "user", organization_id: "org", facility_id: "facility", lead_id: "lead" };
    let stored: string | null = JSON.stringify({ ...scope, request_id: "first", action_id: "action" });
    const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; }, removeItem: () => { stored = null; } };
    saveRecoveryIdentifier(storage, scope, "second", "action");
    expect(readRecoveryIdentifiers(storage, scope).map((entry) => entry.request_id)).toEqual(["first", "second"]);
    removeRecoveryIdentifier(storage, scope, "second");
    expect(readRecoveryIdentifiers(storage, scope).map((entry) => entry.request_id)).toEqual(["first"]);
    removeRecoveryIdentifier(storage, scope, "first");
    expect(stored).toBeNull();
  });

});
