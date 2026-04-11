/**
 * ADL scoring + LOC tier + fee calculation (HAVEN–COL technical handoff).
 * Pure functions — safe for unit tests / Edge reuse.
 */

export type ADLScore = {
  bathing: number;
  dressing: number;
  toileting: number;
  transferring: number;
  continence: number;
  feeding: number;
  ambulation: number;
  grooming: number;
};

export enum LOCTier {
  NONE = "NONE",
  L1 = "L1",
  L2 = "L2",
  L3 = "L3",
}

/** Maps to Postgres enum `loc_tier`: none | l1 | l2 | l3 */
export function locTierToDb(tier: LOCTier): "none" | "l1" | "l2" | "l3" {
  const m: Record<LOCTier, "none" | "l1" | "l2" | "l3"> = {
    [LOCTier.NONE]: "none",
    [LOCTier.L1]: "l1",
    [LOCTier.L2]: "l2",
    [LOCTier.L3]: "l3",
  };
  return m[tier];
}

export function dbToLocTier(v: string): LOCTier {
  switch (v) {
    case "none":
      return LOCTier.NONE;
    case "l1":
      return LOCTier.L1;
    case "l2":
      return LOCTier.L2;
    case "l3":
      return LOCTier.L3;
    default:
      return LOCTier.NONE;
  }
}

const TIER_FEES_CENTS: Record<LOCTier, number> = {
  [LOCTier.NONE]: 0,
  [LOCTier.L1]: 25_000,
  [LOCTier.L2]: 50_000,
  [LOCTier.L3]: 75_000,
};

const WANDER_GUARD_SURCHARGE_CENTS = 25_000;

function assertCategory(name: keyof ADLScore, v: number) {
  if (!Number.isFinite(v) || v < 0 || v > 5) {
    throw new RangeError(`ADL ${name} must be between 0 and 5`);
  }
}

export function validateAdlScore(score: ADLScore): void {
  (Object.keys(score) as (keyof ADLScore)[]).forEach((k) => assertCategory(k, score[k]));
}

export function sumAdlScore(score: ADLScore): number {
  validateAdlScore(score);
  return (
    score.bathing +
    score.dressing +
    score.toileting +
    score.transferring +
    score.continence +
    score.feeding +
    score.ambulation +
    score.grooming
  );
}

/**
 * Band total score into LOC tier (operational default — tune with clinical leadership).
 */
export function tierFromTotalScore(total: number): LOCTier {
  if (total <= 8) return LOCTier.NONE;
  if (total <= 16) return LOCTier.L1;
  if (total <= 24) return LOCTier.L2;
  return LOCTier.L3;
}

export interface CalculateLocResult {
  totalScore: number;
  locTier: LOCTier;
  /** Monthly LOC line in cents before wander surcharge */
  baseFeeCents: number;
  wanderGuard: boolean;
  /** Final monthly LOC line in cents */
  calculatedFeeCents: number;
}

export function calculateLOC(score: ADLScore, wanderGuard: boolean): CalculateLocResult {
  const totalScore = sumAdlScore(score);
  const locTier = tierFromTotalScore(totalScore);
  const baseFeeCents = TIER_FEES_CENTS[locTier];
  const wanderAddon = wanderGuard ? WANDER_GUARD_SURCHARGE_CENTS : 0;
  return {
    totalScore,
    locTier,
    baseFeeCents,
    wanderGuard,
    calculatedFeeCents: baseFeeCents + wanderAddon,
  };
}
