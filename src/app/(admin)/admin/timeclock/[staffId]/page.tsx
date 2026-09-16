"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { StaffTimesheet } from "@/components/timeclock/StaffTimesheet";

export default function AdminTimeclockStaffPage() {
  const params = useParams();
  const raw = params?.staffId;
  const staffId = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  return (
    <Suspense fallback={<AdminTableLoadingState />}>
      <StaffTimesheet staffId={staffId} />
    </Suspense>
  );
}
