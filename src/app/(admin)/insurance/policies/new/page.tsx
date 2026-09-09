"use client";

import { Suspense } from "react";
import { InsuranceNewPolicyPage } from "@/components/insurance/workspace-pages";
export default function NewPolicyPage() {
  return (
    <Suspense fallback={<p role="status">Loading policy draft…</p>}>
      <InsuranceNewPolicyPage />
    </Suspense>
  );
}
