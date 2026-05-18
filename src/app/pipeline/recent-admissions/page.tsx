"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

function RecentAdmissionsRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/admissions");
  }, [router]);

  return (
    <div className="p-6 text-[13px] text-muted-foreground" role="status">
      Redirecting…
    </div>
  );
}

export default function RecentAdmissionsRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Redirecting…
        </div>
      }
    >
      <RecentAdmissionsRedirectInner />
    </Suspense>
  );
}
