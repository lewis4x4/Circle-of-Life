import { describe, expect, it } from "vitest";
import { parseJournalFormLines } from "./journal-form-lines";

const valid = [
  { gl_account_id: "cash", debit: "0.29", credit: "" },
  { gl_account_id: "clearing", debit: "", credit: "0.29" },
];
describe("HFA-036 journal input integrity", () => {
  it("keeps exact line amounts and ignores only wholly empty rows", () => {
    expect(parseJournalFormLines([{ gl_account_id: "", debit: " ", credit: "" }, ...valid])).toEqual({ ok: true, debitCents: 29, creditCents: 29, lines: [
      { gl_account_id: "cash", debit_cents: 29, credit_cents: 0, line_number: 1 },
      { gl_account_id: "clearing", debit_cents: 0, credit_cents: 29, line_number: 2 },
    ] });
  });
  it.each([
    { gl_account_id: "cash", debit: "1.005", credit: "" },
    { gl_account_id: "cash", debit: "1e3", credit: "" },
    { gl_account_id: "cash", debit: "bad", credit: "" },
    { gl_account_id: "cash", debit: "-1", credit: "" },
    { gl_account_id: "cash", debit: "1", credit: "1" },
    { gl_account_id: "", debit: "1", credit: "" },
    { gl_account_id: "cash", debit: "", credit: "" },
  ])("rejects an invalid entered line even alongside a balanced journal: %j", invalid => {
    expect(parseJournalFormLines([...valid, invalid]).ok).toBe(false);
  });
  it("preserves unbalanced drafts for further editing", () => {
    expect(parseJournalFormLines([valid[0]]).ok).toBe(true);
  });
  it("rejects an individual line beyond its database integer bound", () => {
    expect(parseJournalFormLines([{ ...valid[0], debit: "21474836.48" }]).ok).toBe(false);
    expect(parseJournalFormLines([{ ...valid[1], credit: "21474836.48" }]).ok).toBe(false);
    expect(parseJournalFormLines([{ ...valid[0], debit: "21474836.47" }])).toMatchObject({ ok: true, debitCents: 2147483647 });
  });
  it("supports aggregate totals beyond 32-bit cents using storable lines", () => {
    expect(parseJournalFormLines([{ ...valid[0], debit: "20000000" }, { ...valid[0], debit: "20000000" }])).toMatchObject({ ok: true, debitCents: 4000000000 });
  });
});
