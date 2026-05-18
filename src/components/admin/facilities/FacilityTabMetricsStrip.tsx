"use client";

import React from "react";
import type { FacilityTab } from "@/lib/admin/facilities/facility-constants";
import type { FacilityDetailRow } from "@/types/facility";
import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import { FacilityOperationsMetricsStrip } from "@/components/admin/facilities/FacilityHeader";
import { FacilityComplianceMetricsStrip } from "@/components/admin/facilities/FacilityComplianceMetricsStrip";
import {
  FacilityRatesMetricsStrip,
  type FacilityRateRow,
} from "@/components/admin/facilities/FacilityRatesMetricsStrip";
import { FacilityBuildingMetricsStrip } from "@/components/admin/facilities/FacilityBuildingMetricsStrip";
import { FacilityEmergencyContactsMetricsStrip } from "@/components/admin/facilities/FacilityEmergencyContactsMetricsStrip";
import type { SlotContext } from "@/lib/admin/facilities/emergency-kpis";

export function FacilityTabMetricsStrip({
  tab,
  facility,
  rates,
  buildingProfile,
  buildingProfileLoading,
  emergency,
}: {
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
}) {
  if (tab === "emergency" && emergency) {
    return (
      <FacilityEmergencyContactsMetricsStrip
        contacts={emergency.contacts}
        isLoading={emergency.isLoading}
        slotContext={emergency.slotContext}
      />
    );
  }
  if (tab === "building") {
    return (
      <FacilityBuildingMetricsStrip
        facilityId={facility.id}
        profile={buildingProfile}
        profileLoading={buildingProfileLoading}
      />
    );
  }
  if (tab === "licensing") {
    return <FacilityComplianceMetricsStrip facility={facility} />;
  }
  if (tab === "rates") {
    return <FacilityRatesMetricsStrip facility={facility} rates={rates} />;
  }
  return <FacilityOperationsMetricsStrip facility={facility} />;
}
