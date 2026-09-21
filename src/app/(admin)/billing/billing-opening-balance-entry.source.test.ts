import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ledgerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./billing-invoice-ledger.tsx"),
  "utf8",
);

describe("opening-balance workflow entry point", () => {
  it("exposes the workflow from the invoice ledger action bar", () => {
    expect(ledgerSource).toContain('href="/admin/billing/invoices/opening-balance"');
    expect(ledgerSource).toContain("Enter opening balance");
  });
});
