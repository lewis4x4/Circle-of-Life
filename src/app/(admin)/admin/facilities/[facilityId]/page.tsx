"use client";

import React, { Suspense, useCallback } from "react";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFacility } from "@/hooks/useFacility";
import { FacilityHeader } from "@/components/admin/facilities/FacilityHeader";
import { FacilityTabNav } from "@/components/admin/facilities/FacilityTabNav";
import { OverviewTab } from "@/components/admin/facilities/tabs/OverviewTab";
import { RatesTab } from "@/components/admin/facilities/tabs/RatesTab";
import { DocumentsTab } from "@/components/admin/facilities/tabs/DocumentsTab";
import { AuditTab } from "@/components/admin/facilities/tabs/AuditTab";
import { LicensingTab } from "@/components/admin/facilities/tabs/LicensingTab";
import { BuildingTab } from "@/components/admin/facilities/tabs/BuildingTab";
import { EmergencyTab } from "@/components/admin/facilities/tabs/EmergencyTab";
import { VendorsTab } from "@/components/admin/facilities/tabs/VendorsTab";
import { StaffingTab } from "@/components/admin/facilities/tabs/StaffingTab";
import { CommunicationTab } from "@/components/admin/facilities/tabs/CommunicationTab";
import { ThresholdsTab } from "@/components/admin/facilities/tabs/ThresholdsTab";
import { TimelineTab } from "@/components/admin/facilities/tabs/TimelineTab";
import {
  FACILITY_TABS,
  FACILITY_TAB_LABELS,
  type FacilityTab,
} from "@/lib/admin/facilities/facility-constants";

const TABS = FACILITY_TABS.map((id) => ({
  id,
  label: FACILITY_TAB_LABELS[id],
}));

function isFacilityTab(t: string | null): t is FacilityTab {
  return t != null && (FACILITY_TABS as readonly string[]).includes(t);
}

interface FacilityDetailPageProps {
  params: {
    facilityId: string;
  };
}

function FacilityDetailInner({ facilityId }: { facilityId: string }) {
  const { facility, isLoading, error } = useFacility(facilityId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: FacilityTab = isFacilityTab(tabParam) ? tabParam : "overview";

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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error || !facility) {
    return (
      <div className="space-y-6 p-6">
        <Link
          href="/admin/facilities"
          className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Facilities
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error ?? "Facility not found"}</p>
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return <OverviewTab facilityId={facilityId} />;
      case "licensing":
        return <LicensingTab facilityId={facilityId} />;
      case "rates":
        return <RatesTab facilityId={facilityId} />;
      case "building":
        return <BuildingTab facilityId={facilityId} />;
      case "emergency":
        return <EmergencyTab facilityId={facilityId} />;
      case "vendors":
        return <VendorsTab facilityId={facilityId} />;
      case "documents":
        return <DocumentsTab facilityId={facilityId} />;
      case "staffing":
        return <StaffingTab facilityId={facilityId} />;
      case "communication":
        return <CommunicationTab facilityId={facilityId} />;
      case "thresholds":
        return <ThresholdsTab facilityId={facilityId} />;
      case "audit":
        return <AuditTab facilityId={facilityId} />;
      case "timeline":
        return <TimelineTab facilityId={facilityId} />;
      default:
        return <OverviewTab facilityId={facilityId} />;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/admin/facilities"
        className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Facilities
      </Link>

      <FacilityHeader facility={facility} />

      <div className="border-b border-gray-200 overflow-x-auto">
        <FacilityTabNav activeTab={activeTab} onTabChange={onTabChange} tabs={TABS} />
      </div>

      <div className="pt-4">{renderTabContent()}</div>
    </div>
  );
}

export default function FacilityDetailPage({ params }: FacilityDetailPageProps) {
  const { facilityId } = params;
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        </div>
      }
    >
      <FacilityDetailInner facilityId={facilityId} />
    </Suspense>
  );
}
