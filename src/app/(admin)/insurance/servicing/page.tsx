"use client";
import { Suspense } from "react";
import { ServicingListPage } from "@/components/insurance/servicing-pages";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading insurance servicing…</p>}>
      <ServicingListPage />
    </Suspense>
  );
}
