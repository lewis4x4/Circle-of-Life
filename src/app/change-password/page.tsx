"use client";

import { useRouter } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { appRole, mustChangePassword, loading, refresh } = useHavenAuth();

  const handleSuccess = async () => {
    await refresh();
    router.replace(getDashboardRouteForRole(appRole) || "/admin");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-[1.5rem] border bg-card p-6 shadow-lg">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Change password</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading your account…"
              : mustChangePassword
                ? "Required before you can use Haven."
                : "Update your sign-in password."}
          </p>
        </header>
        {!loading && <ChangePasswordForm forced={mustChangePassword} onSuccess={handleSuccess} />}
      </div>
    </div>
  );
}
