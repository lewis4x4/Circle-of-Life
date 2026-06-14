export type PettyCashDirection = "credit" | "debit";
export type TrustDirection = "deposit" | "withdrawal";

export const PETTY_CASH_CATEGORIES: { id: string; label: string }[] = [
  { id: "replenishment", label: "Replenishment" },
  { id: "resident_expense", label: "Resident expense" },
  { id: "office_supply", label: "Office supply" },
  { id: "food", label: "Food" },
  { id: "reimbursement", label: "Reimbursement" },
  { id: "other", label: "Other" },
];

export const TRUST_CATEGORIES: { id: string; label: string }[] = [
  { id: "benefit_deposit", label: "Benefit deposit" },
  { id: "personal_needs", label: "Personal needs allowance" },
  { id: "purchase", label: "Purchase" },
  { id: "refund", label: "Refund" },
  { id: "transfer", label: "Transfer" },
  { id: "other", label: "Other" },
];

export type PettyCashAccountRow = {
  id: string;
  name: string;
  balance_cents: number;
  is_active: boolean;
};

export type PettyCashTxRow = {
  id: string;
  direction: PettyCashDirection;
  amount_cents: number;
  balance_after_cents: number;
  category: string;
  description: string;
  resident_id: string | null;
  occurred_at: string;
};

export type TrustAccountRow = {
  id: string;
  resident_id: string;
  balance_cents: number;
  is_rep_payee: boolean;
  ssa_787_on_file: boolean;
  is_active: boolean;
};

export type TrustTxRow = {
  id: string;
  account_id: string;
  resident_id: string;
  direction: TrustDirection;
  amount_cents: number;
  balance_after_cents: number;
  category: string;
  description: string;
  occurred_at: string;
};

export type ResidentMini = { id: string; first_name: string; last_name: string };

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function categoryLabel(list: { id: string; label: string }[], id: string): string {
  return list.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

/** Signed delta for a petty-cash post (credit adds, debit subtracts). */
export function pettyCashDelta(direction: PettyCashDirection, amountCents: number): number {
  return direction === "credit" ? amountCents : -amountCents;
}

/** Signed delta for a trust post (deposit adds, withdrawal subtracts). */
export function trustDelta(direction: TrustDirection, amountCents: number): number {
  return direction === "deposit" ? amountCents : -amountCents;
}
