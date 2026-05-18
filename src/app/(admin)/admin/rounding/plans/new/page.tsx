"use client";

import { useSearchParams } from "next/navigation";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useFacilityStore } from "@/hooks/useFacilityStore";

export default function AdminRoundingPlanNewPage() {
  const searchParams = useSearchParams();
  const duplicatePlanId = searchParams.get("duplicatePlanId")?.trim() || undefined;
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

      <ObservationPlanEditor duplicatePlanId={duplicatePlanId} title={duplicatePlanId ? "Duplicate observation plan" : "Create observation plan"} />
    </div>
  );
}
