import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { AppShell } from "@/components/layout/AppShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function ClinicalLayout({ children }: { children: ReactNode }) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <AppShell>{children}</AppShell>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
