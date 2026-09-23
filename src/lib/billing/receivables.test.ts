import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BILLED_INVOICE_STATUSES,
  CURRENT_AR_INVOICE_STATUSES,
  RECEIVABLE_INVOICE_STATUSES,
  UNSETTLED_INVOICE_STATUSES,
  currentArNotYetSentNote,
  isOpenReceivable,
  isPastDueReceivable,
  notYetSentCaption,
  summarizeReceivables,
} from "./receivables";

// Homewood on 2026-09-22 (COL-565): 10 overdue May invoices carrying $16,968.00,
// 28 August drafts, 29 September drafts, 23 paid May invoices.
const homewood = [
  ...Array.from({ length: 10 }, () => ({ status: "overdue", balanceDueCents: 169_680, dueDateIso: "2026-05-15" })),
  ...Array.from({ length: 23 }, () => ({ status: "paid", balanceDueCents: 0, dueDateIso: "2026-05-15" })),
  ...Array.from({ length: 28 }, () => ({ status: "draft", balanceDueCents: 201_979, dueDateIso: "2026-08-05" })),
  ...Array.from({ length: 29 }, () => ({ status: "draft", balanceDueCents: 208_807, dueDateIso: "2026-09-05" })),
];

describe("receivables definition (COL-650)", () => {
  it("never counts a draft as a receivable", () => {
    expect(RECEIVABLE_INVOICE_STATUSES).not.toContain("draft");
    expect(BILLED_INVOICE_STATUSES).not.toContain("draft");
    expect(isOpenReceivable({ status: "draft", balanceDueCents: 100 })).toBe(false);
    expect(isPastDueReceivable({ status: "draft", balanceDueCents: 100, dueDateIso: "2026-08-05" }, "2026-09-22")).toBe(
      false,
    );
  });

  it("counts sent, partly paid and overdue invoices with a balance", () => {
    for (const status of ["sent", "partial", "overdue"]) {
      expect(isOpenReceivable({ status, balanceDueCents: 1 })).toBe(true);
      expect(isOpenReceivable({ status, balanceDueCents: 0 })).toBe(false);
    }
    for (const status of ["paid", "void", "written_off"]) {
      expect(isOpenReceivable({ status, balanceDueCents: 1 })).toBe(false);
    }
  });

  it("treats past due as a date fact, not a stored status", () => {
    const sentLate = { status: "sent", balanceDueCents: 500, dueDateIso: "2026-09-05" };
    expect(isPastDueReceivable(sentLate, "2026-09-05")).toBe(false);
    expect(isPastDueReceivable(sentLate, "2026-09-06")).toBe(true);
    const overdueNotYetDue = { status: "overdue", balanceDueCents: 500, dueDateIso: "2026-10-05" };
    expect(isPastDueReceivable(overdueNotYetDue, "2026-09-22")).toBe(false);
  });

  it("reproduces Homewood: $16,968.00 receivable, all past due, drafts reported apart", () => {
    const summary = summarizeReceivables(homewood, "2026-09-22");
    expect(summary.receivableCents).toBe(1_696_800);
    expect(summary.receivableCount).toBe(10);
    expect(summary.pastDueCount).toBe(10);
    expect(summary.pastDueCents).toBe(1_696_800);
    expect(summary.notYetSentCount).toBe(57);
  });

  it("names the drafts a figure leaves out", () => {
    expect(notYetSentCaption(0, "$0.00")).toBeNull();
    expect(notYetSentCaption(1, "$10.00")).toBe("1 draft ($10.00) not yet sent — not included");
    expect(notYetSentCaption(57, "$117,108.16")).toBe("57 drafts ($117,108.16) not yet sent — not included");
  });

  it("keeps drafts out of every money set and only in the unsettled work set", () => {
    expect(UNSETTLED_INVOICE_STATUSES).toEqual(["draft", "sent", "partial", "overdue"]);
  });

  it("defines Stand Up Current AR as everything owed if every resident pays (COL-665 ruling)", () => {
    expect(CURRENT_AR_INVOICE_STATUSES).toEqual(["draft", "sent", "partial", "overdue"]);
    const summary = summarizeReceivables(homewood, "2026-09-22");
    // Billing's Outstanding AR plus the drafts beside it add up to the Stand Up figure.
    const currentAr = homewood
      .filter((invoice) => (CURRENT_AR_INVOICE_STATUSES as readonly string[]).includes(invoice.status))
      .reduce((total, invoice) => total + invoice.balanceDueCents, 0);
    expect(currentAr).toBe(summary.receivableCents + summary.notYetSentCents);
    expect(currentArNotYetSentNote(57, "$117,108")).toBe("Includes $117,108 in 57 drafts not yet sent.");
    expect(currentArNotYetSentNote(0, "$0")).toBe("Includes no drafts; every invoice in it has been sent.");
  });
});

/**
 * One definition, enforced: no money page may carry its own invoice-status list.
 * A literal array or Set naming "sent" together with "partial" or "overdue" is a
 * second definition of receivable and fails here.
 */
describe("no second receivable definition", () => {
  const repoRoot = process.cwd();
  const roots = ["src/app", "src/lib", "src/components"];
  const allowed: Record<string, string> = {
    "src/lib/billing/receivables.ts": "the definition itself",
    "src/lib/billing/load-invoices.ts": "the InvoiceStatusUi union type, not a filter",
    "src/app/(admin)/billing/billing-invoice-ledger.tsx": "HUB_LEDGER_STATUS_CHIPS lists every status as a filter chip",
  };

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  const listPattern = /\[[^\]\n]*"sent"[^\]\n]*\]/g;

  it("finds invoice-status lists only in allowed files", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, file);
        if (rel in allowed) continue;
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(listPattern)) {
          if (/"partial"|"overdue"/.test(match[0])) offenders.push(`${rel}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
