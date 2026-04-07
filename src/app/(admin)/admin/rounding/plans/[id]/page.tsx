"use client";

import { useParams } from "next/navigation";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";

export default function AdminRoundingPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = params?.id ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Edit observation plan</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Adjust cadence, daypart rules, and grace windows without losing audit history.</p>
      </div>

      <RoundingHubNav />

      <ObservationPlanEditor planId={planId} title="Edit observation plan" />
    </div>
  );
}
