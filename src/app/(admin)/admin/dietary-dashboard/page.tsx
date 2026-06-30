"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { isDietaryRole } from "@/lib/auth/app-role";

export default function DietaryDashboardRedirectPage() {
  const router = useRouter();
  const { appRole, loading } = useHavenAuth();

  useEffect(() => {
    if (loading) return;

    if (isDietaryRole(appRole)) {
      router.replace("/dietary");
      return;
    }

    router.replace("/admin/dietary");
  }, [appRole, loading, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        Redirecting to the dietary workspace...
      </div>
    </div>
  );
}
