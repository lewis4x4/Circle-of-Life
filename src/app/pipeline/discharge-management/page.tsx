"use client";

import { Suspense } from "react";

import { DischargeMedRecHub } from "@/components/admin/discharge/discharge-med-rec-hub";

/** Product Pipeline URL — renders the canonical med reconciliation hub (no redirect). */
export default function PipelineDischargeManagementPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-2 py-10 text-[13px] text-muted-foreground" role="status">
          Loading discharge pipeline…
        </div>
      }
    >
      <DischargeMedRecHub hubBasePath="/pipeline/discharge-management" />
    </Suspense>
  );
}
