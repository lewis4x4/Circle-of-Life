"use client";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import { Card, CardContent } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  OfficerAlertsPanel,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  officerAlarmTone,
  officerCountLabel,
  officerAlertsEmptyDescription,
  officerKpiValue,
  officerRegisterKpi,
  useFacilityNameMap,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";

export default function CooDashboardPage() {
  const { organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);
  const facilityNameById = useFacilityNameMap(facilities);

  const facilityName = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? null
    : null;
  const subtitle = selectedFacilityId
    ? facilityName
      ? `This facility — COO operations board for ${facilityName}, not a portfolio roll-up.`
      : "This facility — COO operations board (facility name not loaded), not a portfolio roll-up."
    : "COO operations board — all facilities in your organization.";

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
  const registers = kpis?.registers;
  const openEscalations = registers?.openRoundingEscalations ?? null;
  const medErrorsTile = officerRegisterKpi(medErrors, registers?.medicationErrorsRecorded, loading, "Med errors (MTD)", "warning");
  const outbreaksTile = officerRegisterKpi(outbreaks, registers?.outbreaksRecorded, loading, "Active outbreaks", "danger");
  const deficienciesLane =
    registers?.surveyDeficienciesRecorded === false ? "No deficiencies recorded yet" : officerCountLabel(deficiencies, "deficiencies");

  const lanes: OfficerLane[] = [
    {
      stat:
        openEscalations != null && openEscalations > 0
          ? `${officerCountLabel(overdue, "overdue")} · ${openEscalations} open escalations`
          : officerCountLabel(overdue, "overdue"),
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
      stat: deficienciesLane,
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
    <div className="relative w-full">
      <div className="border-b border-border px-6 py-3 sm:px-12">
        <ExecutiveHubNav />
      </div>

      <OfficerHeader title="Chief Operating Officer" subtitle={subtitle} />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
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
          <OfficerKpiTile label="Med errors (MTD)" value={medErrorsTile.value} tone={medErrorsTile.tone} />
          <OfficerKpiTile label="Active outbreaks" value={outbreaksTile.value} tone={outbreaksTile.tone} />
          <OfficerKpiTile label="Overdue tasks" value={officerKpiValue(overdue, loading, "Overdue tasks")} tone={officerAlarmTone(overdue, "warning")} />
        </OfficerKpiStrip>

        <OfficerLanes lanes={lanes} subheading="Jump into the live operating queues." />
        <OfficerAlertsPanel
          heading="Operational alerts"
          emptyTitle="No open operational alerts"
          emptyDescription={officerAlertsEmptyDescription(openEscalations)}
          alerts={alerts}
          facilityNameById={facilityNameById}
          loading={loading}
          error={fetchErrorBannerMessage}
          onRetry={refetch}
        />
      </div>
    </div>
  );
}
