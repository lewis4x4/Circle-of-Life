"use client";

import { Suspense } from "react";

import { DischargeMedRecHubClient } from "@/components/admin/discharge/discharge-med-rec-hub-client";

export type DischargeMedRecHubProps = {
  hubBasePath: string;
};

/** Client-only hub mount for pipeline routes without RSC bootstrap. */
export function DischargeMedRecHub({ hubBasePath }: DischargeMedRecHubProps) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-2 py-10 text-[13px] text-muted-foreground" role="status">
          Loading discharge pipeline…
        </div>
      }
    >
      <DischargeMedRecHubClient
        hubBasePath={hubBasePath}
        initialRows={[]}
        initialLoadFailed={false}
        initialIsRowsCapped={false}
        initialFacilityId={null}
        initialScope="month"
      />
    </Suspense>
  );
}
