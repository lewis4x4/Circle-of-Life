/**
 * Stable UUID demo rows so /admin/billing/invoices/[id] works when Supabase has no data.
 * IDs must satisfy the app UUID regex (version + variant nibble rules).
 */

export const DEMO_INVOICE_IDS = {
  inv1: "f0000001-0001-4001-8001-000000000001",
  inv2: "f0000002-0001-4001-8001-000000000002",
  inv3: "f0000003-0001-4001-8001-000000000003",
  inv4: "f0000004-0001-4001-8001-000000000004",
} as const;

const DEMO_RESIDENT_ID = "a0000001-0001-4001-8001-000000000099";
const DEMO_FACILITY_ID = "a0000002-0001-4001-8001-000000000099";

export type DemoInvoiceShape = {
  id: string;
  resident_id: string;
  facility_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  status: string;
  subtotal: number;
  adjustments: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  payer_type: string | null;
  payer_name: string | null;
  notes: string | null;
  deleted_at: null;
};

export type DemoLineShape = {
  id: string;
  description: string;
  line_type: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order: number;
};

export type DemoInvoiceBundle = {
  invoice: DemoInvoiceShape;
  lines: DemoLineShape[];
  residentName: string;
};

const BUNDLES: Record<string, DemoInvoiceBundle> = {
  [DEMO_INVOICE_IDS.inv1]: {
    residentName: "Margaret Sullivan",
    invoice: {
      id: DEMO_INVOICE_IDS.inv1,
      resident_id: DEMO_RESIDENT_ID,
      facility_id: DEMO_FACILITY_ID,
      invoice_number: "INV-2026-03-145",
      invoice_date: "2026-03-01",
      due_date: "2026-04-05",
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      status: "sent",
      subtotal: 754_250,
      adjustments: 0,
      tax: 0,
      total: 754_250,
      amount_paid: 0,
      balance_due: 754_250,
      payer_type: "private_pay",
      payer_name: "Sullivan family trust",
      notes: "Demo invoice — private suite monthly.",
      deleted_at: null,
    },
    lines: [
      {
        id: "e0000001-0001-4001-8001-000000000001",
        description: "Monthly base (private)",
        line_type: "room_board",
        quantity: 1,
        unit_price: 650_000,
        total: 650_000,
        sort_order: 0,
      },
      {
        id: "e0000001-0001-4001-8001-000000000002",
        description: "Care level 2 surcharge",
        line_type: "care",
        quantity: 1,
        unit_price: 104_250,
        total: 104_250,
        sort_order: 1,
      },
    ],
  },
  [DEMO_INVOICE_IDS.inv2]: {
    residentName: "Arthur Pendelton",
    invoice: {
      id: DEMO_INVOICE_IDS.inv2,
      resident_id: DEMO_RESIDENT_ID,
      facility_id: DEMO_FACILITY_ID,
      invoice_number: "INV-2026-03-142",
      invoice_date: "2026-03-01",
      due_date: "2026-03-15",
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      status: "paid",
      subtotal: 420_000,
      adjustments: 0,
      tax: 0,
      total: 420_000,
      amount_paid: 420_000,
      balance_due: 0,
      payer_type: "medicaid_oss",
      payer_name: "State Medicaid",
      notes: null,
      deleted_at: null,
    },
    lines: [
      {
        id: "e0000002-0001-4001-8001-000000000001",
        description: "Medicaid monthly cap",
        line_type: "room_board",
        quantity: 1,
        unit_price: 420_000,
        total: 420_000,
        sort_order: 0,
      },
    ],
  },
  [DEMO_INVOICE_IDS.inv3]: {
    residentName: "Lucille Booth",
    invoice: {
      id: DEMO_INVOICE_IDS.inv3,
      resident_id: DEMO_RESIDENT_ID,
      facility_id: DEMO_FACILITY_ID,
      invoice_number: "INV-2026-03-140",
      invoice_date: "2026-03-01",
      due_date: "2026-04-02",
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      status: "partial",
      subtotal: 500_000,
      adjustments: 0,
      tax: 0,
      total: 500_000,
      amount_paid: 284_700,
      balance_due: 215_300,
      payer_type: "ltc_insurance",
      payer_name: "Mutual LTC",
      notes: "Demo partial payment applied.",
      deleted_at: null,
    },
    lines: [
      {
        id: "e0000003-0001-4001-8001-000000000001",
        description: "Semi-private monthly",
        line_type: "room_board",
        quantity: 1,
        unit_price: 500_000,
        total: 500_000,
        sort_order: 0,
      },
    ],
  },
  [DEMO_INVOICE_IDS.inv4]: {
    residentName: "William Hastings",
    invoice: {
      id: DEMO_INVOICE_IDS.inv4,
      resident_id: DEMO_RESIDENT_ID,
      facility_id: DEMO_FACILITY_ID,
      invoice_number: "INV-2026-02-098",
      invoice_date: "2026-02-01",
      due_date: "2026-03-10",
      period_start: "2026-02-01",
      period_end: "2026-02-29",
      status: "overdue",
      subtotal: 198_750,
      adjustments: 0,
      tax: 0,
      total: 198_750,
      amount_paid: 0,
      balance_due: 198_750,
      payer_type: "private_pay",
      payer_name: null,
      notes: "Demo overdue balance.",
      deleted_at: null,
    },
    lines: [
      {
        id: "e0000004-0001-4001-8001-000000000001",
        description: "February balance forward",
        line_type: "adjustment",
        quantity: 1,
        unit_price: 198_750,
        total: 198_750,
        sort_order: 0,
      },
    ],
  },
};

export function getDemoInvoiceBundle(invoiceId: string): DemoInvoiceBundle | null {
  return BUNDLES[invoiceId] ?? null;
}

export function isDemoInvoiceId(invoiceId: string): boolean {
  return invoiceId in BUNDLES;
}
