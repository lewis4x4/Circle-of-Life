"use client";

import { useSearchParams } from "next/navigation";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "@/lib/rounding/observation-plan-display-copy";

export default function AdminRoundingPlanNewPage() {
  const searchParams = useSearchParams();
  const duplicatePlanId = searchParams.get("duplicatePlanId")?.trim() || undefined;
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = selectedFacilityId
    ? availableFacilities.find((facility) => facility.id === selectedFacilityId)
    : null;
  const subtitle = selectedFacility
    ? `Create resident cadence rules and grace windows for live rounding at ${selectedFacility.name}.`
    : OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="New observation plan"
        subtitle={subtitle}
      />

      <RoundingHubNav />

      <ObservationPlanEditor duplicatePlanId={duplicatePlanId} title={duplicatePlanId ? "Duplicate observation plan" : "Create observation plan"} />
    </div>
  );
}
