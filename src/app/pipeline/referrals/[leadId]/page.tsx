"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

/** Product URL: `/pipeline/referrals/[leadId]` → canonical lead detail (`/admin/referrals/[id]`). */
function PipelineReferralDetailRedirectInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = typeof params?.leadId === "string" ? params.leadId.trim() : "";
    if (!id) {
      router.replace("/admin/referrals");
      return;
    }
    const q = searchParams.toString();
    router.replace(q ? `/admin/referrals/${encodeURIComponent(id)}?${q}` : `/admin/referrals/${encodeURIComponent(id)}`);
  }, [params?.leadId, router, searchParams]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function PipelineReferralDetailRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <PipelineReferralDetailRedirectInner />
    </Suspense>
  );
}
