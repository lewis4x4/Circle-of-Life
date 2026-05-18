import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const admissionsSource = readSource("src/app/(admin)/admin/admissions/page.tsx");
const invoiceSource = readSource("src/app/(admin)/vendors/invoices/page.tsx");
const purchaseOrderSource = readSource("src/app/(admin)/vendors/purchase-orders/page.tsx");

describe("admin list query bounds", () => {
  it("bounds admissions hub preview list queries without changing head-count patterns", () => {
    expect(admissionsSource).toContain("const ADMISSIONS_HUB_PREVIEW_LIMIT = 100;");

    const limitMatches = admissionsSource.match(/\.limit\(ADMISSIONS_HUB_PREVIEW_LIMIT\)/g) ?? [];
    expect(limitMatches).toHaveLength(5);

    expect(admissionsSource).toContain('.select("id", { count: "exact", head: true })');
  });

  it("limits vendor invoices list query to rendered columns", () => {
    expect(invoiceSource).toContain("const VENDOR_INVOICE_LIST_LIMIT = 150;");
    expect(invoiceSource).toContain('.select("id, invoice_number, status, invoice_date, total_cents")');
    expect(invoiceSource).toContain(".limit(VENDOR_INVOICE_LIST_LIMIT)");
    expect(invoiceSource).not.toContain('.select("*")');
  });

  it("limits purchase orders list query to rendered columns", () => {
    expect(purchaseOrderSource).toContain("const PURCHASE_ORDER_LIST_LIMIT = 150;");
    expect(purchaseOrderSource).toContain('.select("id, po_number, status, order_date, total_cents")');
    expect(purchaseOrderSource).toContain(".limit(PURCHASE_ORDER_LIST_LIMIT)");
    expect(purchaseOrderSource).not.toContain('.select("*")');
  });
});
