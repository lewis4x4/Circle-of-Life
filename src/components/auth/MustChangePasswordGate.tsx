"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { isChangePasswordExemptPath } from "@/lib/auth/must-change-password";

export function MustChangePasswordGate({ children }: { children: React.ReactNode }) {
  const { mustChangePassword, loading, user } = useHavenAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user || !mustChangePassword) {
      return;
    }
    if (!isChangePasswordExemptPath(pathname)) {
      router.replace("/change-password");
    }
  }, [loading, mustChangePassword, pathname, router, user]);

  if (!loading && user && mustChangePassword && !isChangePasswordExemptPath(pathname)) {
    return null;
  }

  return children;
}
