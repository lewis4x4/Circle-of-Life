"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  formatRoleHomeBounceMessage,
  getRoleDashboardConfig,
  isRoleHomeRouteMatch,
  ROLE_HOME_CHECKING_MESSAGE,
} from "@/lib/auth/dashboard-routing";

type RoleHomePageGateProps = {
  expectedRoute: string;
  homeAudienceLabel: string;
  checkingMessage?: string;
  children: ReactNode;
};

export function RoleHomeRouteLoading({ message }: { message: string }) {
  return (
    <div
      data-testid="role-home-route-loading"
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] items-center justify-center px-6"
    >
      <p className="max-w-md text-center text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

export function RoleHomePageGate({
  expectedRoute,
  homeAudienceLabel,
  checkingMessage = ROLE_HOME_CHECKING_MESSAGE,
  children,
}: RoleHomePageGateProps) {
  const router = useRouter();
  const { appRole, loading: authLoading } = useHavenAuth();
  const visitorConfig = getRoleDashboardConfig(appRole);
  const isWrongRole = !authLoading && !isRoleHomeRouteMatch(appRole, expectedRoute);

  useEffect(() => {
    if (authLoading) return;
    if (visitorConfig.route !== expectedRoute) {
      router.replace(visitorConfig.route);
    }
  }, [authLoading, expectedRoute, router, visitorConfig.route]);

  if (authLoading) {
    return <RoleHomeRouteLoading message={`${checkingMessage}…`} />;
  }

  if (isWrongRole) {
    return (
      <RoleHomeRouteLoading
        message={formatRoleHomeBounceMessage(homeAudienceLabel, visitorConfig.roleLabel)}
      />
    );
  }

  return children;
}
