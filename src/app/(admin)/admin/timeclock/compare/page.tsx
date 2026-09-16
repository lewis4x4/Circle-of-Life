"use client";

import { Suspense } from "react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { UpunchCompare } from "@/components/timeclock/UpunchCompare";

export default function AdminTimeclockComparePage() {
  return (
    <Suspense fallback={<AdminTableLoadingState />}>
      <UpunchCompare />
    </Suspense>
  );
}
