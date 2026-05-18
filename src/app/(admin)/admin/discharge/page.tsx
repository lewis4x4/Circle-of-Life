"use client";

import { Suspense } from "react";

import { DischargeMedRecHub } from "@/components/admin/discharge/discharge-med-rec-hub";

export default function AdminDischargeHubPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-2 py-10 text-[13px] text-muted-foreground" role="status">
          Loading discharge pipeline…
        </div>
      }
    >
      <DischargeMedRecHub hubBasePath="/admin/discharge" />
    </Suspense>
  );
}
