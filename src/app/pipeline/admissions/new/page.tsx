"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Canonical product URL: `/pipeline/admissions/new` → admin intake form (`/admin/admissions/new`). */
function PipelineAdmissionsNewRedirectInner() {
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

export default function PipelineAdmissionsNewRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <PipelineAdmissionsNewRedirectInner />
    </Suspense>
  );
}
