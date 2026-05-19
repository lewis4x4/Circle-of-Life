"use client";

import React, { Suspense, useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFacility } from "@/hooks/useFacility";
import { useFacilityBuildingProfile } from "@/hooks/useFacilityBuildingProfile";
import { useFacilityRates } from "@/hooks/useFacilityRates";
import { useFacilityEmergencyContacts } from "@/hooks/useFacilityEmergencyContacts";
import { useFacilityStaffKpis } from "@/hooks/useFacilityStaffKpis";
import { useFacilityVendors } from "@/hooks/useFacilityVendors";
import { useFacilityDocumentVaultMetrics } from "@/hooks/useFacilityDocumentVaultMetrics";
import { useFacilityCommunicationSettings } from "@/hooks/useFacilityCommunicationSettings";
import { useFacilityThresholds, type ThresholdRow } from "@/hooks/useFacilityThresholds";
import { useFacilityAuditMetrics } from "@/hooks/useFacilityAuditMetrics";
import {
  countFlMandatoryVendorComplianceGaps,
  vendorCategorySetFromLinkedVendors,
} from "@/lib/vendors/vendor-fl-requirements";
import { Badge } from "@/components/ui/badge";
import { FacilityHeader } from "@/components/admin/facilities/FacilityHeader";
import { FacilityTabNav } from "@/components/admin/facilities/FacilityTabNav";
import { FacilityAuditSubscribeButton } from "@/components/admin/facilities/FacilityAuditSubscribeButton";
import { RecordDetailHeader } from "@/design-system/components/record-detail";
import {
  FACILITY_TABS,
  FACILITY_OVERFLOW_TABS,
  FACILITY_TAB_LABELS,
  type FacilityTab,
} from "@/lib/admin/facilities/facility-constants";
import { formatFacilityDetailSubtitle } from "@/lib/admin/facilities/format-facility-metadata";
import { AUDIT_RETENTION_COPY, FACILITY_AUDIT_TAB_HELPER } from "@/lib/admin/facilities/facility-audit-ui";
const TABS = FACILITY_TABS.map((id) => ({
  id,
  label: FACILITY_TAB_LABELS[id],
}));

const TabBodyLoading = () => (
  <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    Loading tab…
  </div>
);

const OverviewTab = dynamic(
  () => import("@/components/admin/facilities/tabs/OverviewTab").then((m) => m.OverviewTab),
  { loading: TabBodyLoading },
);
const RatesTab = dynamic(() => import("@/components/admin/facilities/tabs/RatesTab").then((m) => m.RatesTab), {
  loading: TabBodyLoading,
});
const DocumentsTab = dynamic(
  () => import("@/components/admin/facilities/tabs/DocumentsTab").then((m) => m.DocumentsTab),
  { loading: TabBodyLoading },
);
const AuditTab = dynamic(() => import("@/components/admin/facilities/tabs/AuditTab").then((m) => m.AuditTab), {
  loading: TabBodyLoading,
});
const LicensingTab = dynamic(
  () => import("@/components/admin/facilities/tabs/LicensingTab").then((m) => m.LicensingTab),
  { loading: TabBodyLoading },
);
const BuildingTab = dynamic(
  () => import("@/components/admin/facilities/tabs/BuildingTab").then((m) => m.BuildingTab),
  { loading: TabBodyLoading },
);
const EmergencyTab = dynamic(
  () => import("@/components/admin/facilities/tabs/EmergencyTab").then((m) => m.EmergencyTab),
  { loading: TabBodyLoading },
);
const VendorsTab = dynamic(
  () => import("@/components/admin/facilities/tabs/VendorsTab").then((m) => m.VendorsTab),
  { loading: TabBodyLoading },
);
const StaffingTab = dynamic(
  () => import("@/components/admin/facilities/tabs/StaffingTab").then((m) => m.StaffingTab),
  { loading: TabBodyLoading },
);
const CommunicationTab = dynamic(
  () => import("@/components/admin/facilities/tabs/CommunicationTab").then((m) => m.CommunicationTab),
  { loading: TabBodyLoading },
);
const ThresholdsTab = dynamic(
  () => import("@/components/admin/facilities/tabs/ThresholdsTab").then((m) => m.ThresholdsTab),
  { loading: TabBodyLoading },
);
const TimelineTab = dynamic(
  () => import("@/components/admin/facilities/tabs/TimelineTab").then((m) => m.TimelineTab),
  { loading: TabBodyLoading },
);

function isFacilityTab(t: string | null): t is FacilityTab {
  return t != null && (FACILITY_TABS as readonly string[]).includes(t);
}

const OVERFLOW_TAB_SET = new Set<FacilityTab>(FACILITY_OVERFLOW_TABS);

function FacilityDetailInner({ facilityId }: { facilityId: string }) {
  const { facility, isLoading, error } = useFacility(facilityId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: FacilityTab = isFacilityTab(tabParam) ? tabParam : "overview";

  const needsRates = activeTab === "rates" || activeTab === "audit";
  const needsBuildingProfile =
    activeTab === "building" || activeTab === "emergency" || activeTab === "vendors" || activeTab === "audit";
  const needsEmergencyContacts =
    activeTab === "emergency" || activeTab === "vendors" || activeTab === "audit";

  const ratesApi = useFacilityRates(facilityId, { enabled: needsRates });
  const buildingProfileApi = useFacilityBuildingProfile(facilityId, { enabled: needsBuildingProfile });

  /** Emergency directory is needed for Vendor KPI completeness on the vendors tab plus Emergency UI. */
  const emergencyApi = useFacilityEmergencyContacts(facilityId, { enabled: needsEmergencyContacts });
  const vendorFacilities = useFacilityVendors(facilityId, {
    enabled: activeTab === "vendors",
  });
  const documentVaultMetrics = useFacilityDocumentVaultMetrics(facilityId, activeTab === "documents");
  const communicationSettingsApi = useFacilityCommunicationSettings(
    facilityId,
    activeTab === "communication",
  );
  const thresholdsApi = useFacilityThresholds(facilityId, {
    enabled: activeTab === "thresholds",
  });
  const [thresholdStripSnapshot, setThresholdStripSnapshot] = useState<ThresholdRow[]>([]);

  const emergencySlotContext = useMemo(() => {
    const p = buildingProfileApi.profile;
    const floors =
      typeof p?.number_of_floors === "number" && p.number_of_floors > 0 ? p.number_of_floors : 1;
    return { floorCount: floors, hasElevator: Boolean(p?.has_elevator) };
  }, [buildingProfileApi.profile]);
  const staffKpis = useFacilityStaffKpis(facilityId, activeTab === "staffing");

  const canonicalVendorRows = useMemo(
    () => vendorFacilities.rows.filter((row) => !String(row.id).startsWith("facility-launch-")),
    [vendorFacilities.rows],
  );

  const vendorComplianceGaps = useMemo(() => {
    return countFlMandatoryVendorComplianceGaps({
      linkedCategories: vendorCategorySetFromLinkedVendors(canonicalVendorRows),
      vendorRowsCanonical: canonicalVendorRows,
      buildingProfile: buildingProfileApi.profile as Record<string, unknown> | null,
      emergencyContacts: emergencyApi.contacts,
    });
  }, [buildingProfileApi.profile, canonicalVendorRows, emergencyApi.contacts]);

  const suspectedAuditInfrastructureGap = useMemo(() => {
    const p = buildingProfileApi.profile as Record<string, unknown> | null;
    const buildingTouches = Boolean(
      p &&
        ("electric_provider" in p ||
          "fire_alarm_monitoring_company" in p ||
          "generator_service_vendor" in p ||
          typeof p.number_of_floors === "number"),
    );
    return emergencyApi.contacts.length > 0 || ratesApi.rates.length > 0 || buildingTouches;
  }, [buildingProfileApi.profile, emergencyApi.contacts.length, ratesApi.rates.length]);

  const auditMetricsApi = useFacilityAuditMetrics(facilityId, activeTab === "audit");

  const onTabChange = useCallback(
    (tabId: string) => {
      if (!isFacilityTab(tabId)) return;
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tabId);
      router.replace(`/admin/facilities/${facilityId}?${next.toString()}`, { scroll: false });
    },
    [facilityId, router, searchParams],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !facility) {
    return (
      <div className="space-y-6 p-6">
        <Link href="/admin/facilities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Facilities
        </Link>
        <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-destructive">{error ?? "Facility not found"}</p>
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return <OverviewTab facilityId={facilityId} facility={facility} />;
      case "licensing":
        return <LicensingTab facilityId={facilityId} />;
      case "rates":
        return (
          <RatesTab
            facility={facility}
            rates={ratesApi.rates}
            isLoading={ratesApi.isLoading}
            error={ratesApi.error}
            isCreating={ratesApi.isCreating}
            isConfirming={ratesApi.isConfirming}
            createRate={ratesApi.createRate}
            confirmRate={ratesApi.confirmRate}
          />
        );
      case "building":
        return (
          <BuildingTab
            facilityId={facilityId}
            facility={facility}
            profile={buildingProfileApi.profile}
            isLoading={buildingProfileApi.isLoading}
            error={buildingProfileApi.error}
            saveProfile={buildingProfileApi.saveProfile}
            isSaving={buildingProfileApi.isSaving}
          />
        );
      case "emergency":
        return (
          <EmergencyTab
            facilityId={facilityId}
            contactsApi={emergencyApi}
            buildingFloors={emergencySlotContext.floorCount}
            hasElevator={emergencySlotContext.hasElevator}
          />
        );
      case "vendors":
        return (
          <VendorsTab
            facilityId={facilityId}
            facilityName={facility.name}
            vendors={{
              rows: vendorFacilities.rows,
              kpi: vendorFacilities.kpi,
              isLoading: vendorFacilities.isLoading || buildingProfileApi.isLoading || emergencyApi.isLoading,
              error: vendorFacilities.error,
              refetch: vendorFacilities.refetch,
            }}
            buildingProfile={buildingProfileApi.profile as Record<string, unknown> | null}
            emergencyContacts={emergencyApi.contacts}
          />
        );
      case "documents":
        return <DocumentsTab facilityId={facilityId} />;
      case "staffing":
        return <StaffingTab facilityId={facilityId} facility={facility} staffKpis={staffKpis} />;
      case "communication":
        return <CommunicationTab facilityId={facilityId} communicationApi={communicationSettingsApi} />;
      case "thresholds":
        return (
          <ThresholdsTab
            facility={facility}
            facilityId={facilityId}
            orgDefaults={thresholdsApi.orgDefaults}
            thresholds={thresholdsApi.thresholds}
            isLoading={thresholdsApi.isLoading}
            error={thresholdsApi.error}
            saveThresholds={thresholdsApi.saveThresholds}
            isSaving={thresholdsApi.isSaving}
            onLiveRowsChange={setThresholdStripSnapshot}
          />
        );
      case "audit":
        return (
          <AuditTab
            key={facilityId}
            facilityId={facilityId}
            suspectedSurfaceSignals={suspectedAuditInfrastructureGap}
            metricsSummary={auditMetricsApi.data}
          />
        );
      case "timeline":
        return <TimelineTab facilityId={facilityId} />;
      default:
        return <OverviewTab facilityId={facilityId} facility={facility} />;
    }
  };

  const statusChip = (() => {
    if (facility.status === "inactive") return <Badge variant="secondary">Inactive</Badge>;
    if (facility.status === "under_renovation") return <Badge variant="outline" className="border-warning/50 text-warning">Under renovation</Badge>;
    if (facility.status === "archived") return <Badge variant="outline">Archived</Badge>;
    return <Badge variant="default">Active</Badge>;
  })();

  return (
    <div className="space-y-6 pt-4 p-6 max-w-7xl mx-auto">
      <RecordDetailHeader
        title={facility.name}
        subtitle={formatFacilityDetailSubtitle({
          city: facility.city,
          state: facility.state,
          licenseNumber: facility.ahca_license_number ?? facility.license_number ?? null,
        })}
        backLink={{ label: "Facilities", href: "/admin/facilities" }}
        statusChips={statusChip}
        actions={
          activeTab === "audit" ? (
            <FacilityAuditSubscribeButton facilityId={facilityId} facilityName={facility.name} />
          ) : undefined
        }
      />

      <FacilityHeader
        tab={activeTab}
        facility={facility}
        rates={ratesApi.rates}
        buildingProfile={buildingProfileApi.profile}
        buildingProfileLoading={buildingProfileApi.isLoading}
        vendorStrip={
          activeTab === "vendors"
            ? {
                loading: vendorFacilities.isLoading || buildingProfileApi.isLoading || emergencyApi.isLoading,
                kpi: vendorFacilities.kpi,
                complianceGapCount:
                  vendorFacilities.isLoading || buildingProfileApi.isLoading || emergencyApi.isLoading
                    ? 0
                    : vendorComplianceGaps,
              }
            : undefined
        }
        documentVaultStrip={
          activeTab === "documents"
            ? { loading: documentVaultMetrics.loading, kpi: documentVaultMetrics.kpi }
            : undefined
        }
        emergency={
          activeTab === "emergency"
            ? {
                contacts: emergencyApi.contacts,
                isLoading: emergencyApi.isLoading,
                slotContext: emergencySlotContext,
              }
            : undefined
        }
        staffStrip={
          activeTab === "staffing"
            ? {
                loading: staffKpis.loading,
                kpi: staffKpis.data,
                error: staffKpis.error,
              }
            : undefined
        }
        communicationStrip={
          activeTab === "communication"
            ? {
                loading: communicationSettingsApi.isLoading,
                settings: communicationSettingsApi.settings,
              }
            : undefined
        }
        thresholdsStrip={
          activeTab === "thresholds"
            ? {
                loading: thresholdsApi.isLoading,
                rows: thresholdStripSnapshot,
                orgDefaults: thresholdsApi.orgDefaults,
              }
            : undefined
        }
        auditStrip={
          activeTab === "audit"
            ? {
                loading: auditMetricsApi.loading,
                metrics: auditMetricsApi.data,
                retentionCopy: AUDIT_RETENTION_COPY,
              }
            : undefined
        }
      />

      <div className="border-b border-border overflow-x-auto">
        <FacilityTabNav activeTab={activeTab} onTabChange={onTabChange} tabs={TABS} />
      </div>

      {OVERFLOW_TAB_SET.has(activeTab) ? (
        <div className="space-y-3 pt-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {FACILITY_TAB_LABELS[activeTab]}
          </h2>
          <div className="h-px w-full bg-border" aria-hidden />
          {activeTab === "documents" ? (
            <p className="max-w-3xl text-sm text-muted-foreground">
              Centralize AHCA filings, inspections, drills, permits, certificates, carrier policies, and vendor
              agreements here. Prefer <span className="font-medium text-foreground">Replace</span> on an existing row
              so surveyors never chase stale duplicates — the vault keeps proof tied to taxonomy and expiry rules.
            </p>
          ) : null}
          {activeTab === "audit" ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{FACILITY_AUDIT_TAB_HELPER}</p>
          ) : null}
        </div>
      ) : null}

      <div className={OVERFLOW_TAB_SET.has(activeTab) ? "pt-6" : "pt-4"}>{renderTabContent()}</div>
    </div>
  );
}

/**
 * Next.js App Router passes `params` as a Promise for server pages; client pages must read
 * the dynamic segment via `useParams()` or facilityId is undefined and the detail API 404s.
 */
function FacilityRouteResolver() {
  const params = useParams<{ facilityId: string }>();
  const facilityId = params.facilityId;
  const id = typeof facilityId === "string" ? facilityId : Array.isArray(facilityId) ? facilityId[0] : "";

  if (!id) {
    return (
      <div className="space-y-6 p-6">
        <Link href="/admin/facilities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Facilities
        </Link>
        <div className="rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Missing facility in the URL. Use Command → Facilities and select a site again.
        </div>
      </div>
    );
  }

  return <FacilityDetailInner facilityId={id} />;
}

export default function FacilityDetailPage() {
  return (
      <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <FacilityRouteResolver />
    </Suspense>
  );
}
