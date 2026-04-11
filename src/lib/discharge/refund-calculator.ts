/**
 * Private-pay refund helper at discharge (daily rate = monthly / 30, floored at zero).
 */

export interface RefundInputs {
  /** Monthly room & board in cents */
  monthlyRateCents: number;
  /** Billable month days unused (integer) */
  unusedDays: number;
  /** One-time deductions (damage, unpaid ancillary) in cents */
  deductionsCents?: number;
}

export function calculateRefund(input: RefundInputs): number {
  const { monthlyRateCents, unusedDays, deductionsCents = 0 } = input;
  if (monthlyRateCents < 0 || unusedDays < 0 || deductionsCents < 0) {
    throw new RangeError("Refund inputs must be non-negative");
  }
  const daily = Math.floor(monthlyRateCents / 30);
  const raw = daily * unusedDays - deductionsCents;
  return Math.max(0, raw);
}
