"use client";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useFacilityStore } from "@/hooks/useFacilityStore";

export default function AdminRoundingPlanNewPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const facilityName =
    availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? "selected facility";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="New observation plan"
        subtitle={`Create resident cadence rules and grace windows for live rounding at ${facilityName}.`}
      />

      <RoundingHubNav />

      <ObservationPlanEditor title="Create observation plan" />
    </div>
  );
}
