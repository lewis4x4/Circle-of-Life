import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { MedTechShell } from "@/components/layout/MedTechShell";

export default function MedTechRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <MedTechShell>{children}</MedTechShell>
    </AppRuntimeProviders>
  );
}
