"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Product URL `/pipeline/discharge-management` → admin med reconciliation hub. */
function Inner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const rest = new URLSearchParams(searchParams.toString());
    const qs = rest.toString();
    router.replace(`/admin/discharge${qs.length ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function PipelineDischargeManagementRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}
