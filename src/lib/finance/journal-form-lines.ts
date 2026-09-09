import { parseDollarsToCents } from "./format-cents";

type JournalFormLine = { gl_account_id: string; debit: string; credit: string };
type JournalLine = { gl_account_id: string; debit_cents: number; credit_cents: number; line_number: number };

/** Validate every entered line before saving; invalid input must not become zero. */
export function parseJournalFormLines(input: readonly JournalFormLine[]):
  | { ok: true; lines: JournalLine[]; debitCents: number; creditCents: number }
  | { ok: false; error: string } {
  const lines: JournalLine[] = [];
  let debit = BigInt(0);
  let credit = BigInt(0);
  for (const [index, row] of input.entries()) {
    if (!row.gl_account_id && !row.debit.trim() && !row.credit.trim()) continue;
    const dc = row.debit.trim() ? parseDollarsToCents(row.debit) : 0;
    const cc = row.credit.trim() ? parseDollarsToCents(row.credit) : 0;
    if (dc === null || cc === null || dc < 0 || cc < 0) {
      return { ok: false, error: `Enter valid nonnegative amounts with at most two decimal places on line ${index + 1}.` };
    }
    // Each stored journal line uses PostgreSQL integer; aggregate controls can be larger.
    if (dc > 2147483647 || cc > 2147483647) {
      return { ok: false, error: `The amount on line ${index + 1} exceeds the supported journal-line limit of $21,474,836.47.` };
    }
    if (!row.gl_account_id || (dc > 0) === (cc > 0)) {
      return { ok: false, error: `Choose an account and enter a positive debit or credit, on one side only, on line ${index + 1}.` };
    }
    debit += BigInt(dc);
    credit += BigInt(cc);
    if (debit > BigInt(Number.MAX_SAFE_INTEGER) || credit > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, error: "Journal totals exceed the supported exact-cent range." };
    }
    lines.push({ gl_account_id: row.gl_account_id, debit_cents: dc, credit_cents: cc, line_number: lines.length + 1 });
  }
  return { ok: true, lines, debitCents: Number(debit), creditCents: Number(credit) };
}
