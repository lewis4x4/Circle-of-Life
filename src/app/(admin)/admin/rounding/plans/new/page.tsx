"use client";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { ObservationPlanEditor } from "@/components/rounding/ObservationPlanEditor";

export default function AdminRoundingPlanNewPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">New observation plan</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create resident cadence rules and grace windows for live rounding.</p>
      </div>

      <RoundingHubNav />

      <ObservationPlanEditor title="Create observation plan" />
    </div>
  );
}
