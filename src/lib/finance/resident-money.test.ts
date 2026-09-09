import { describe, expect, it } from "vitest";
import { residentMoneySchema } from "./resident-money";
const fixture = () => ({
  as_of: "2026-09-09T00:00:00Z", canonical_ledger: "resident_trust_transactions", external_reconciliation: "NOT_VERIFIED",
  rows: [{ resident_id: "00000000-0000-0000-0003-000000000001", facility_id: "00000000-0000-0000-0002-000000000003",
    account_id: null, balance_cents: null, ledger_movement_cents: "0", legacy_balance_cents: 300,
    legacy_entry_count: 1, ledger_entry_count: 0, last_entry_at: null, legacy_review_required: true, ledger_matches_balance: false }],
});
describe("HFA-014 mapped resident-money response contract", () => {
  it("accepts existing PostgreSQL portfolio UUIDs without inventing a canonical zero", () => {
    const parsed = residentMoneySchema.parse(fixture());
    expect(parsed.rows[0].facility_id).toBe("00000000-0000-0000-0002-000000000003");
    expect(parsed.rows[0].balance_cents).toBeNull();
    expect(parsed.rows[0].legacy_balance_cents).toBe(300);
    expect(parsed.external_reconciliation).toBe("NOT_VERIFIED");
  });
  it("rejects malformed scope identities", () => {
    const value = fixture(); value.rows[0].facility_id = "not-a-facility";
    expect(residentMoneySchema.safeParse(value).success).toBe(false);
  });
});
