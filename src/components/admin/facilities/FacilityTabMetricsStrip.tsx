"use client";

import React from "react";
import type { FacilityTab } from "@/lib/admin/facilities/facility-constants";
import type { FacilityDetailRow } from "@/types/facility";
import { FacilityOperationsMetricsStrip } from "@/components/admin/facilities/FacilityHeader";
import { FacilityComplianceMetricsStrip } from "@/components/admin/facilities/FacilityComplianceMetricsStrip";
import {
  FacilityRatesMetricsStrip,
  type FacilityRateRow,
} from "@/components/admin/facilities/FacilityRatesMetricsStrip";

export function FacilityTabMetricsStrip({
  tab,
  facility,
  rates,
}: {
  tab: FacilityTab;
  facility: FacilityDetailRow;
  rates: FacilityRateRow[];
}) {
  if (tab === "licensing") {
    return <FacilityComplianceMetricsStrip facility={facility} />;
  }
  if (tab === "rates") {
    return <FacilityRatesMetricsStrip facility={facility} rates={rates} />;
  }
  return <FacilityOperationsMetricsStrip facility={facility} />;
}
