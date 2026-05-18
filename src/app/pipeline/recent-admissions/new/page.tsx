"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Alias for product URLs (`/pipeline/recent-admissions/new` → canonical admin form). */
function RecentAdmissionsNewRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const q = searchParams.toString();
    router.replace(q ? `/admin/admissions/new?${q}` : "/admin/admissions/new");
  }, [router, searchParams]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function RecentAdmissionsNewRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <RecentAdmissionsNewRedirectInner />
    </Suspense>
  );
}
