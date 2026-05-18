"use client";

import React, { Suspense, useCallback } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFacility } from "@/hooks/useFacility";
import { Badge } from "@/components/ui/badge";
import { FacilityHeader } from "@/components/admin/facilities/FacilityHeader";
import { FacilityComplianceMetricsStrip } from "@/components/admin/facilities/FacilityComplianceMetricsStrip";
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
import { RecordDetailHeader } from "@/design-system/components/record-detail";
import {
  FACILITY_TABS,
  FACILITY_TAB_LABELS,
  type FacilityTab,
} from "@/lib/admin/facilities/facility-constants";
import { formatFacilityDetailSubtitle } from "@/lib/admin/facilities/format-facility-metadata";
const TABS = FACILITY_TABS.map((id) => ({
  id,
  label: FACILITY_TAB_LABELS[id],
}));

function isFacilityTab(t: string | null): t is FacilityTab {
  return t != null && (FACILITY_TABS as readonly string[]).includes(t);
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
          county: facility.county,
          licenseNumber: facility.ahca_license_number ?? facility.license_number ?? null,
          facilityOperationalStatus: facility.status ?? "active",
        })}
        backLink={{ label: "Facilities", href: "/admin/facilities" }}
        statusChips={statusChip}
      />

      {activeTab === "licensing" ? (
        <FacilityComplianceMetricsStrip facility={facility} />
      ) : (
        <FacilityHeader facility={facility} />
      )}

      <div className="border-b border-border overflow-x-auto">
        <FacilityTabNav activeTab={activeTab} onTabChange={onTabChange} tabs={TABS} />
      </div>

      <div className="pt-4">{renderTabContent()}</div>
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
