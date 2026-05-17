"use client";

import { useParams } from "next/navigation";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";
import { RecordDetailHeader } from "@/design-system/components/record-detail";

export default function AdminRoundingPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = params?.id ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <RecordDetailHeader
        title="Edit observation plan"
        subtitle="Adjust cadence, daypart rules, and grace windows without losing audit history."
        backLink={{ label: "Rounding", href: "/admin/rounding" }}
      />

      <RoundingHubNav />

      <ObservationPlanEditor planId={planId} title="Edit observation plan" />
    </div>
  );
}
