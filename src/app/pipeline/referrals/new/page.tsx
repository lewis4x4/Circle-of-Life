"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

/** Product URL: `/pipeline/referrals/new` → canonical CRM new lead (`/admin/referrals/new`). */
function PipelineReferralsNewRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/referrals/new");
  }, [router]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function PipelineReferralsNewRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <PipelineReferralsNewRedirectInner />
    </Suspense>
  );
}
