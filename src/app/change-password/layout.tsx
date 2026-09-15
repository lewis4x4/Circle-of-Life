import type { ReactNode } from "react";
import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function ChangePasswordLayout({ children }: { children: ReactNode }) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>{children}</HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
