import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";

export default function AdminRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppRuntimeProviders>{children}</AppRuntimeProviders>;
}
