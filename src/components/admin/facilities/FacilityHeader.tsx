"use client";

/**
 * Facility Detail — tab-aware KPI strip (Quiet Operator).
 *
 * Single entry point: {@link FacilityHeader}. Pass the active facility tab plus the same contextual
 * props the page already loads (rates rows, building profile, emergency contacts, vendor rows, …).
 *
 * Never mount {@link FacilityOverviewMetricsStrip} directly on non-overview routes — Overview KPIs leak.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { FacilityDetailRow } from "@/types/facility";
import type { FacilityTab } from "@/lib/admin/facilities/facility-constants";
import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import type { SlotContext } from "@/lib/admin/facilities/emergency-directory";
import { SurveyRecencyKpiTile } from "@/components/admin/facilities/SurveyRecencyKpiTile";
import {
  portfolioLaborCostTextClass,
  portfolioOccupancyKpiTextClass,
} from "@/lib/admin/facilities/portfolio-metrics";
import { FacilityComplianceMetricsStrip } from "@/components/admin/facilities/FacilityComplianceMetricsStrip";
import {
  FacilityRatesMetricsStrip,
  type FacilityRateRow,
} from "@/components/admin/facilities/FacilityRatesMetricsStrip";
import { FacilityBuildingMetricsStrip } from "@/components/admin/facilities/FacilityBuildingMetricsStrip";
import { FacilityEmergencyContactsMetricsStrip } from "@/components/admin/facilities/FacilityEmergencyContactsMetricsStrip";
import { FacilitySecondaryTabMetricsStrip } from "@/components/admin/facilities/FacilitySecondaryTabMetricsStrip";
import {
  FacilityVendorsMetricsStrip,
  type FacilityVendorStripKpi,
} from "@/components/admin/facilities/FacilityVendorsMetricsStrip";
import { FacilityDocumentVaultMetricsStrip } from "@/components/admin/facilities/FacilityDocumentVaultMetricsStrip";
import type { DocumentVaultKpiPayload } from "@/lib/admin/facilities/document-vault-kpi";
import { FacilityStaffMetricsStrip } from "@/components/admin/facilities/FacilityStaffMetricsStrip";
import { FacilityCommunicationMetricsStrip } from "@/components/admin/facilities/FacilityCommunicationMetricsStrip";
import type { FacilityStaffKpiPayload } from "@/hooks/useFacilityStaffKpis";
import { FacilityThresholdsMetricsStrip } from "@/components/admin/facilities/FacilityThresholdsMetricsStrip";
import { FacilityAuditMetricsStrip } from "@/components/admin/facilities/FacilityAuditMetricsStrip";
import type { ThresholdRow } from "@/hooks/useFacilityThresholds";
import type { OrgDefaultRow } from "@/lib/admin/facilities/operational-threshold-preview";
import type { FacilityAuditMetricsPayload } from "@/hooks/useFacilityAuditMetrics";

interface FacilityOverviewMetricsStripProps {
  facility: FacilityDetailRow;
}

/** Operations KPI tiles for Facility Overview contexts. */
export function FacilityOverviewMetricsStrip({ facility }: FacilityOverviewMetricsStripProps) {
  const openIncidents = facility.portfolio_open_incidents_total ?? 0;
  const level3 = facility.portfolio_open_incidents_level_3 ?? 0;
  const readiness = facility.survey_readiness_pct;
  const laborPct = facility.labor_cost_mtd_pct;

  const laborOk = typeof laborPct === "number" && Number.isFinite(laborPct);
  const readinessOk = typeof readiness === "number" && Number.isFinite(readiness);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Open incidents</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{openIncidents}</p>
        {level3 > 0 ? (
          <p className="mt-1 text-[12px] tabular-nums text-warning">{level3} level 3 open</p>
        ) : null}
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Labor cost (MTD)</p>
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums",
            laborOk ? portfolioLaborCostTextClass(laborPct!) : "text-muted-foreground",
          )}
        >
          {laborOk ? `${Math.round(laborPct)}%` : "—"}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">Share of census revenue</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Survey readiness</p>
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums",
            readinessOk ? portfolioOccupancyKpiTextClass(readiness!) : "text-muted-foreground",
          )}
        >
          {readinessOk ? `${Math.round(readiness)}%` : "—"}
        </p>
      </div>

      <SurveyRecencyKpiTile lastSurveyDate={facility.last_survey_date} />
    </div>
  );
}

/** @deprecated Use {@link FacilityOverviewMetricsStrip}. */
export const FacilityOperationsMetricsStrip = FacilityOverviewMetricsStrip;

export type FacilityHeaderProps = {
  tab: FacilityTab;
  facility: FacilityDetailRow;
  rates: FacilityRateRow[];
  buildingProfile: Record<string, unknown> | null;
  buildingProfileLoading: boolean;
  emergency?: {
    contacts: EmergencyContactRow[];
    isLoading: boolean;
    slotContext: SlotContext;
  };
  vendorStrip?: {
    loading: boolean;
    kpi: FacilityVendorStripKpi | null;
    complianceGapCount: number;
  };
  documentVaultStrip?: {
    loading: boolean;
    kpi: DocumentVaultKpiPayload | null;
  };
  staffStrip?: {
    loading: boolean;
    kpi: FacilityStaffKpiPayload | null;
    error: string | null;
  };
  /** Present on Communications & Policy tab — replaces generic secondary placeholder strip. */
  communicationStrip?: {
    loading: boolean;
    settings: Record<string, unknown> | null;
  };
  /** Alert thresholds tab — operational KPI tiles + live preview coupling. */
  thresholdsStrip?: {
    loading: boolean;
    rows: ThresholdRow[];
    orgDefaults: OrgDefaultRow[];
  };
  auditStrip?: {
    loading: boolean;
    metrics: FacilityAuditMetricsPayload | null;
    retentionCopy: string;
  };
};

/**
 * Tab-aware facility KPI primitive — resolves the full strip for Rates, Building & Safety,
 * Emergency Contacts, Vendors, Document Vault, Licensing, Overview, etc.
 */
export function FacilityHeader(props: FacilityHeaderProps) {
  const {
    tab,
    facility,
    rates,
    buildingProfile,
    buildingProfileLoading,
    emergency,
    vendorStrip,
    documentVaultStrip,
    staffStrip,
    communicationStrip,
    thresholdsStrip,
    auditStrip,
  } = props;

  switch (tab) {
    case "overview":
      return <FacilityOverviewMetricsStrip facility={facility} />;
    case "licensing":
      return <FacilityComplianceMetricsStrip facility={facility} />;
    case "rates":
      return <FacilityRatesMetricsStrip facility={facility} rates={rates} />;
    case "building":
      return (
        <FacilityBuildingMetricsStrip
          facilityId={facility.id}
          profile={buildingProfile}
          profileLoading={buildingProfileLoading}
        />
      );
    case "emergency":
      if (!emergency) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return (
        <FacilityEmergencyContactsMetricsStrip
          contacts={emergency.contacts}
          isLoading={emergency.isLoading}
          slotContext={emergency.slotContext}
        />
      );
    case "vendors":
      if (!vendorStrip) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[122px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return (
        <FacilityVendorsMetricsStrip
          loading={vendorStrip.loading}
          kpi={vendorStrip.kpi}
          complianceGapCount={vendorStrip.complianceGapCount}
        />
      );
    case "documents":
      if (!documentVaultStrip) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[122px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return <FacilityDocumentVaultMetricsStrip loading={documentVaultStrip.loading} kpi={documentVaultStrip.kpi} />;
    case "staffing":
      if (!staffStrip) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[122px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return (
        <FacilityStaffMetricsStrip
          facility={facility}
          loading={staffStrip.loading}
          kpi={staffStrip.kpi}
          kpiError={staffStrip.error}
        />
      );
    case "communication":
      if (communicationStrip) {
        return (
          <FacilityCommunicationMetricsStrip
            loading={communicationStrip.loading}
            settings={communicationStrip.settings}
          />
        );
      }
      return <FacilitySecondaryTabMetricsStrip tab={tab} />;
    case "thresholds":
      if (!thresholdsStrip) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return (
        <FacilityThresholdsMetricsStrip
          loading={thresholdsStrip.loading}
          facility={facility}
          rows={thresholdsStrip.rows}
          orgDefaults={thresholdsStrip.orgDefaults}
        />
      );
    case "audit":
      if (!auditStrip) {
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
            ))}
          </div>
        );
      }
      return (
        <FacilityAuditMetricsStrip
          loading={auditStrip.loading}
          metrics={auditStrip.metrics}
          retentionCopy={auditStrip.retentionCopy}
        />
      );
    case "timeline":
      return <FacilitySecondaryTabMetricsStrip tab={tab} />;
    default:
      return <FacilitySecondaryTabMetricsStrip tab={tab} />;
  }
}
