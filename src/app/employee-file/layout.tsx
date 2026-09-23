import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { SelfServiceRoleShell } from "@/components/layout/SelfServiceRoleShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function EmployeeFileLayout({ children }: { children: ReactNode }) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <SelfServiceRoleShell>{children}</SelfServiceRoleShell>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
