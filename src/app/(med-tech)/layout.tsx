import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { MedTechShell } from "@/components/layout/MedTechShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function MedTechRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <MedTechShell>{children}</MedTechShell>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
