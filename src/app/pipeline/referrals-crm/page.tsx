"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Alias for product URLs under `/pipeline/referrals-crm` (`?tab=…` maps to `/admin/referrals/…`).
 */
function PipelineReferralsCrmRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "new-lead") {
      router.replace("/admin/referrals/new");
      return;
    }
    if (tab === "sources") {
      router.replace("/admin/referrals/sources");
      return;
    }
    if (
      tab === "inbox" ||
      tab === "hl7-inbound" ||
      tab === "referral-inbox"
    ) {
      const rest = new URLSearchParams(searchParams);
      rest.delete("tab");
      const qs = rest.toString();
      router.replace(`/admin/referrals/hl7-inbound${qs.length ? `?${qs}` : ""}`);
      return;
    }
    router.replace("/admin/referrals");
  }, [router, searchParams]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function PipelineReferralsCrmRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <PipelineReferralsCrmRedirectInner />
    </Suspense>
  );
}
