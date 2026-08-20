"use client";

import { useState } from "react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { Card, CardContent } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  HavenInsightPanel,
  OfficerAlertsPanel,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  OfficerLiveViewsNotice,
  officerAlarmTone,
  officerCountLabel,
  officerKpiValue,
  useFacilityNameMap,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";

/** Pills with live pane content on the COO board (stub tabs are hidden for training-week click-around). */
export const COO_LIVE_TABS = ["Operations Hub", "Haven Insight"] as const;

export default function CooDashboardPage() {
  const [tab, setTab] = useState("Operations Hub");
  const { organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);
  const facilityNameById = useFacilityNameMap(facilities);

  const scopeLabel = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? "the selected facility"
    : "all facilities in your organization";
  const subtitle = selectedFacilityId
    ? `This facility — COO operations board for ${scopeLabel}, not a portfolio roll-up.`
    : `COO operations board — ${scopeLabel}, not the enterprise portfolio roll-up.`;

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: kpis != null,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError: error,
  });

  const openIncidents = kpis?.clinical.openIncidents;
  const medErrors = kpis?.clinical.medicationErrorsMtd;
  const outbreaks = kpis?.infection.activeOutbreaks;
  const overdue = kpis?.residentAssurance.overdueTasksCount;
  const certsExpiring = kpis?.workforce.certificationsExpiring30d;
  const deficiencies = kpis?.compliance.openSurveyDeficiencies;

  const lanes: OfficerLane[] = [
    {
      stat: officerCountLabel(overdue, "overdue"),
      title: "Operations queue",
      description: "Recurring tasks, escalations, and missed checks.",
      href: "/admin/operations",
    },
    {
      stat: officerCountLabel(certsExpiring, "certs expiring"),
      title: "Staffing",
      description: "Coverage, ratios, and credential expirations.",
      href: "/admin/staffing",
    },
    {
      stat: officerCountLabel(deficiencies, "deficiencies"),
      title: "Compliance & readiness",
      description: "Survey readiness and emergency preparedness.",
      href: "/admin/compliance/emergency-preparedness",
    },
    {
      stat: "Fleet & rides",
      title: "Transportation",
      description: "Resident transport and vehicle status.",
      href: "/transportation",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <div className="border-b border-border">
        <ExecutiveNavV2
          showTopNav={false}
          activeTopNav="clinical"
          activePillMenu={tab}
          onPillMenuChange={setTab}
          customPillTabs={[...COO_LIVE_TABS]}
        />
      </div>

      <OfficerHeader title="Chief Operating Officer" subtitle={subtitle} />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
        <OfficerLiveViewsNotice count={COO_LIVE_TABS.length} />

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={refetch} />
        ) : null}

        <OfficerKpiStrip>
          <OfficerKpiTile label="Open incidents" value={officerKpiValue(openIncidents, loading, "Open incidents")} tone={officerAlarmTone(openIncidents, "danger")} />
          <OfficerKpiTile label="Med errors (MTD)" value={officerKpiValue(medErrors, loading, "Med errors (MTD)")} tone={officerAlarmTone(medErrors, "warning")} />
          <OfficerKpiTile label="Active outbreaks" value={officerKpiValue(outbreaks, loading, "Active outbreaks")} tone={officerAlarmTone(outbreaks, "danger")} />
          <OfficerKpiTile label="Overdue tasks" value={officerKpiValue(overdue, loading, "Overdue tasks")} tone={officerAlarmTone(overdue, "warning")} />
        </OfficerKpiStrip>

        {tab === "Operations Hub" ? (
          <>
            <OfficerLanes lanes={lanes} subheading="Jump into the live operating queues." />
            <OfficerAlertsPanel
              heading="Operational alerts"
              emptyTitle="No open operational alerts"
              alerts={alerts}
              facilityNameById={facilityNameById}
              loading={loading}
              error={fetchErrorBannerMessage}
              onRetry={refetch}
            />
          </>
        ) : tab === "Haven Insight" ? (
          <HavenInsightPanel domain="operations" />
        ) : null}
      </div>
    </div>
  );
}
