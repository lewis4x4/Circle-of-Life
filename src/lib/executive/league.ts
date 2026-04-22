import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

export type InsurancePolicyMini = {
  id: string;
  entityId: string;
  policyNumber: string;
  carrierName: string;
  policyType: string;
  status: string;
  expirationDate: string;
};

export type InsuranceRenewalMini = {
  id: string;
  entityId: string;
  insurancePolicyId: string;
  status: string;
  targetEffectiveDate: string;
  renewalDataPackageId: string | null;
};

export type RenewalDataPackageMini = {
  id: string;
  entityId: string;
  generatedAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
};

export type RiskSnapshotMini = {
  facilityId: string;
  score: number;
  level: "low" | "moderate" | "high" | "critical";
  scoreDelta: number | null;
};

export type LeagueFacilityBase = {
  facilityId: string;
  facilityName: string;
  entityId: string;
  entityName: string;
};

export type EntityInsuranceReadiness = {
  entityId: string;
  entityName: string;
  readinessScore: number;
  readinessLabel: "ready" | "watch" | "at_risk" | "critical";
  activePolicies: number;
  expiringPolicies60d: number;
  expiredPolicies: number;
  pendingRenewals: number;
  boundRenewals: number;
  latestPacketAt: string | null;
  latestPacketReviewedAt: string | null;
  primaryConcern: string;
};

export type LeagueFacilityRow = LeagueFacilityBase & {
  leagueScore: number;
  leagueLabel: "leading" | "stable" | "watch" | "critical";
  operationalScore: number;
  financialScore: number;
  insuranceScore: number;
  occupancyPct: number | null;
  openInvoicesCount: number;
  totalBalanceDueCents: number;
  riskScore: number | null;
  riskLevel: RiskSnapshotMini["level"] | null;
  boardNote: string;
  primaryConcern: string;
  riskDelta: number | null;
};

export type BoardPacketSummary = {
  weekOf: string | null;
  status: string | null;
  confidenceBand: string | null;
  completenessPct: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  savedPacketCount: number;
  lastSavedAt: string | null;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysUntil(dateString: string) {
  const target = new Date(`${dateString}T12:00:00.000Z`);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function labelForScore(score: number): EntityInsuranceReadiness["readinessLabel"] {
  if (score >= 85) return "ready";
  if (score >= 70) return "watch";
  if (score >= 50) return "at_risk";
  return "critical";
}

function leagueLabel(score: number): LeagueFacilityRow["leagueLabel"] {
  if (score >= 85) return "leading";
  if (score >= 70) return "stable";
  if (score >= 55) return "watch";
  return "critical";
}

export function computeEntityInsuranceReadiness(args: {
  entityId: string;
  entityName: string;
  policies: InsurancePolicyMini[];
  renewals: InsuranceRenewalMini[];
  packages: RenewalDataPackageMini[];
}): EntityInsuranceReadiness {
  const activePolicies = args.policies.filter((policy) => policy.status === "active");
  const expiringPolicies60d = activePolicies.filter((policy) => daysUntil(policy.expirationDate) <= 60).length;
  const expiredPolicies = args.policies.filter((policy) => daysUntil(policy.expirationDate) < 0 || policy.status === "expired").length;
  const pendingRenewals = args.renewals.filter((renewal) => renewal.status === "upcoming" || renewal.status === "in_progress").length;
  const boundRenewals = args.renewals.filter((renewal) => renewal.status === "bound").length;
  const latestPacket = args.packages
    .slice()
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0] ?? null;
  const latestPacketAgeDays = latestPacket ? Math.ceil((Date.now() - new Date(latestPacket.generatedAt).getTime()) / 86_400_000) : null;

  let readinessScore = 100;
  if (activePolicies.length === 0) readinessScore -= 60;
  readinessScore -= Math.min(36, expiringPolicies60d * 12);
  readinessScore -= Math.min(30, expiredPolicies * 20);
  if (pendingRenewals > 0) readinessScore -= 10;
  if (pendingRenewals > 0 && !latestPacket) readinessScore -= 20;
  if (latestPacketAgeDays != null && latestPacketAgeDays > 120) readinessScore -= 10;
  if (latestPacket && !latestPacket.reviewedAt) readinessScore -= 5;

  const score = clampScore(readinessScore);
  let primaryConcern = "Current renewal packet and active policy inventory are present.";
  if (activePolicies.length === 0) {
    primaryConcern = "No active policy inventory is attached to this entity.";
  } else if (expiredPolicies > 0) {
    primaryConcern = `${expiredPolicies} policy record(s) are expired or past the effective window.`;
  } else if (expiringPolicies60d > 0) {
    primaryConcern = `${expiringPolicies60d} active policy record(s) expire within 60 days.`;
  } else if (pendingRenewals > 0 && !latestPacket) {
    primaryConcern = "Renewal work is open without a current packet attached.";
  } else if (latestPacket && !latestPacket.reviewedAt) {
    primaryConcern = "Latest renewal packet is generated but not reviewed.";
  }

  return {
    entityId: args.entityId,
    entityName: args.entityName,
    readinessScore: score,
    readinessLabel: labelForScore(score),
    activePolicies: activePolicies.length,
    expiringPolicies60d,
    expiredPolicies,
    pendingRenewals,
    boundRenewals,
    latestPacketAt: latestPacket?.generatedAt ?? null,
    latestPacketReviewedAt: latestPacket?.reviewedAt ?? null,
    primaryConcern,
  };
}

function computeFinancialHealth(kpi: ExecKpiPayload) {
  if (kpi.census.occupiedResidents <= 0) return 50;
  const balancePerResident = kpi.financial.totalBalanceDueCents / kpi.census.occupiedResidents / 100;
  let score = 100;
  score -= Math.min(30, kpi.financial.openInvoicesCount * 2);
  score -= Math.min(35, balancePerResident / 50);
  return clampScore(score);
}

export function computeLeagueRows(args: {
  facilities: LeagueFacilityBase[];
  kpis: Map<string, ExecKpiPayload>;
  riskSnapshots: Map<string, RiskSnapshotMini>;
  insuranceReadinessByEntity: Map<string, EntityInsuranceReadiness>;
  boardSummary: BoardPacketSummary;
}): LeagueFacilityRow[] {
  return args.facilities
    .map((facility) => {
      const kpi = args.kpis.get(facility.facilityId) ?? null;
      const risk = args.riskSnapshots.get(facility.facilityId) ?? null;
      const insurance = args.insuranceReadinessByEntity.get(facility.entityId) ?? null;
      const occupancyScore = clampScore(kpi?.census.occupancyPct ?? 50);
      const financialScore = kpi ? computeFinancialHealth(kpi) : 50;
      const operationalScore = risk?.score ?? 70;
      const insuranceScore = insurance?.readinessScore ?? 60;
      const leagueScore = clampScore(
        operationalScore * 0.45 +
        occupancyScore * 0.2 +
        financialScore * 0.2 +
        insuranceScore * 0.15,
      );

      let primaryConcern = "Board-ready with no elevated signals.";
      if (risk?.level === "critical" || risk?.level === "high") {
        primaryConcern = `Risk lane ${risk.level} at ${risk.score}/100.`;
      } else if ((insurance?.readinessLabel === "critical" || insurance?.readinessLabel === "at_risk") && insurance) {
        primaryConcern = insurance.primaryConcern;
      } else if ((kpi?.compliance.openSurveyDeficiencies ?? 0) > 0) {
        primaryConcern = `${kpi?.compliance.openSurveyDeficiencies ?? 0} open survey deficiency record(s).`;
      } else if ((kpi?.infection.activeOutbreaks ?? 0) > 0) {
        primaryConcern = `${kpi?.infection.activeOutbreaks ?? 0} active outbreak(s) require containment readiness.`;
      } else if ((kpi?.financial.openInvoicesCount ?? 0) > 10) {
        primaryConcern = `Open AR pressure: ${kpi?.financial.openInvoicesCount ?? 0} invoices remain outstanding.`;
      }

      const boardNote = args.boardSummary.weekOf
        ? `Standup ${args.boardSummary.weekOf} · ${args.boardSummary.confidenceBand ?? "n/a"} confidence · ${Math.round(args.boardSummary.completenessPct ?? 0)}% complete`
        : "No published board packet yet";

      return {
        ...facility,
        leagueScore,
        leagueLabel: leagueLabel(leagueScore),
        operationalScore,
        financialScore,
        insuranceScore,
        occupancyPct: kpi?.census.occupancyPct ?? null,
        openInvoicesCount: kpi?.financial.openInvoicesCount ?? 0,
        totalBalanceDueCents: kpi?.financial.totalBalanceDueCents ?? 0,
        riskScore: risk?.score ?? null,
        riskLevel: risk?.level ?? null,
        boardNote,
        primaryConcern,
        riskDelta: risk?.scoreDelta ?? null,
      };
    })
    .sort((left, right) => right.leagueScore - left.leagueScore);
}
