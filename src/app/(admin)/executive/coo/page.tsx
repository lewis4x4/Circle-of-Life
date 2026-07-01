"use client";

import { useState } from "react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import {
  HavenInsightPanel,
  OfficerAlertsPanel,
  OfficerEmptyTab,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  officerAlarmTone,
  officerCountLabel,
  officerKpiValue,
  useFacilityNameMap,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";

const COO_TABS = [
  "Operations Hub",
  "Staffing",
  "Maintenance",
  "Dining",
  "Satisfaction",
  "Move Ops",
  "Vendors",
  "Readiness",
  "Haven Insight",
];

const TAB_DOMAIN: Record<string, string> = {
  Staffing: "staffing ratios, shift coverage, and credential expirations",
  Maintenance: "work orders and preventive maintenance",
  Dining: "diet orders, meal service, and refusals",
  Satisfaction: "reputation reviews and family satisfaction",
  "Move Ops": "the admissions pipeline and move-in / move-out operations",
  Vendors: "vendor contracts, insurance compliance, and spend",
  Readiness: "survey readiness and emergency preparedness",
};

export default function CooDashboardPage() {
  const [tab, setTab] = useState("Operations Hub");
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);
  const facilityNameById = useFacilityNameMap(facilities);

  const scopeLabel = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? "the selected facility"
    : "all facilities";

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
          customPillTabs={COO_TABS}
        />
      </div>

      <OfficerHeader
        title="Chief Operating Officer"
        subtitle={`Live operations command center — ${scopeLabel}.`}
      />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={refetch} /> : null}

        <OfficerKpiStrip>
          <OfficerKpiTile label="Open incidents" value={officerKpiValue(openIncidents, loading)} tone={officerAlarmTone(openIncidents, "danger")} />
          <OfficerKpiTile label="Med errors (MTD)" value={officerKpiValue(medErrors, loading)} tone={officerAlarmTone(medErrors, "warning")} />
          <OfficerKpiTile label="Active outbreaks" value={officerKpiValue(outbreaks, loading)} tone={officerAlarmTone(outbreaks, "danger")} />
          <OfficerKpiTile label="Overdue tasks" value={officerKpiValue(overdue, loading)} tone={officerAlarmTone(overdue, "warning")} />
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
              error={error}
              onRetry={refetch}
            />
          </>
        ) : tab === "Haven Insight" ? (
          <HavenInsightPanel domain="operations" />
        ) : (
          <OfficerEmptyTab tab={tab} domain={TAB_DOMAIN[tab] ?? "operations"} />
        )}
      </div>
    </div>
  );
}
