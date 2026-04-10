"use client";

import React, { useState } from "react";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useFacility } from "@/hooks/useFacility";
import { FacilityHeader } from "@/components/admin/facilities/FacilityHeader";
import { FacilityTabNav } from "@/components/admin/facilities/FacilityTabNav";
import { OverviewTab } from "@/components/admin/facilities/tabs/OverviewTab";
import { RatesTab } from "@/components/admin/facilities/tabs/RatesTab";
import { DocumentsTab } from "@/components/admin/facilities/tabs/DocumentsTab";
import { AuditTab } from "@/components/admin/facilities/tabs/AuditTab";

interface FacilityDetailPageProps {
  params: {
    facilityId: string;
  };
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "rates", label: "Rate Schedules" },
  { id: "documents", label: "Documents" },
  { id: "audit", label: "Audit Log" },
];

export default function FacilityDetailPage({ params }: FacilityDetailPageProps) {
  const { facilityId } = params;
  const { facility, isLoading, error } = useFacility(facilityId);
  const [activeTab, setActiveTab] = useState("overview");

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
      case "rates":
        return <RatesTab facilityId={facilityId} />;
      case "documents":
        return <DocumentsTab facilityId={facilityId} />;
      case "audit":
        return <AuditTab facilityId={facilityId} />;
      default:
        return <OverviewTab facilityId={facilityId} />;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Back button */}
      <Link
        href="/admin/facilities"
        className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Facilities
      </Link>

      {/* Header with facility info */}
      <FacilityHeader facility={facility} />

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <FacilityTabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} />
      </div>

      {/* Tab Content */}
      <div className="pt-4">
        {renderTabContent()}
      </div>
    </div>
  );
}
