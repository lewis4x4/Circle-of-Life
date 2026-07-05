import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { DietaryShell } from "@/components/layout/DietaryShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function DietaryRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <DietaryShell>{children}</DietaryShell>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
