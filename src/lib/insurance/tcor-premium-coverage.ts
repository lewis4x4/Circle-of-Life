/**
 * How much of the TCoR premium total is actually backed by a stated premium.
 *
 * The TCoR panel sums `premium_cents` across the policies in the window and
 * prints the result beside a policy count. A policy with no recorded premium
 * contributes nothing to the sum but still counts toward the total, so the two
 * figures sit next to each other and invite the reader to believe the money
 * describes the count. With COL's real data that read $24,024.52 under
 * "Policies in window: 17" — one property policy, while the $239,893.00 master
 * general liability programme carried no per-entity premium at all.
 *
 * Suppressing the number is the wrong fix: losses can be real even when no
 * premium is recorded. The number stays and says what it covers.
 */

export type TcorPremiumCoverageInput = {
  policiesInWindow: number;
  policiesWithStatedPremium: number;
};

export type TcorPremiumCoverage = {
  policiesInWindow: number;
  policiesWithStatedPremium: number;
  /** Every policy in the window states a premium. */
  complete: boolean;
  /** A money total is shown that covers fewer policies than the window holds. */
  partial: boolean;
  /** One line naming the coverage. Null only when the window holds no policies. */
  disclosure: string | null;
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function resolveTcorPremiumCoverage(input: TcorPremiumCoverageInput): TcorPremiumCoverage {
  const total = Math.max(0, input.policiesInWindow);
  // A stated count can never exceed the window it is counted from; clamping
  // keeps a bad caller from producing "5 of 3".
  const stated = Math.min(Math.max(0, input.policiesWithStatedPremium), total);
  const complete = total > 0 && stated === total;
  const partial = total > 0 && stated < total;

  let disclosure: string | null;
  if (total === 0) {
    disclosure = null;
  } else if (complete) {
    disclosure = `Premium stated for ${plural(total, "the 1 policy", `all ${total} policies`)} in the window.`;
  } else if (stated === 0) {
    disclosure =
      `No premium is recorded for any of the ${total} ${plural(total, "policy", "policies")} in the window. ` +
      `This total is not a cost of the insurance programme.`;
  } else {
    disclosure =
      `Premium stated for ${stated} of ${total} policies. ` +
      `This total covers only ${plural(stated, "that policy", "those policies")} — it is not the full programme cost.`;
  }

  return { policiesInWindow: total, policiesWithStatedPremium: stated, complete, partial, disclosure };
}
