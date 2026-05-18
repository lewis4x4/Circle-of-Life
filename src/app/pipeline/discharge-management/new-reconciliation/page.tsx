"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

/** Product URL `/pipeline/discharge-management/new-reconciliation` → admin new med reconciliation. */
function Inner() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/discharge/new");
  }, [router]);
  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function PipelineDischargeNewReconciliationRedirectPage() {
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
