import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function ClinicalLayout({ children }: { children: ReactNode }) {
  return (
    <HavenAuthProvider>
      <AppShell>{children}</AppShell>
    </HavenAuthProvider>
  );
}
