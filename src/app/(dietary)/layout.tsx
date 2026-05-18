import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { DietaryShell } from "@/components/layout/DietaryShell";

export default function DietaryRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <DietaryShell>{children}</DietaryShell>
    </AppRuntimeProviders>
  );
}
