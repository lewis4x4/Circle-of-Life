import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { OnboardingShell } from "@/components/layout/OnboardingShell";

export default function OnboardingRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <OnboardingShell>{children}</OnboardingShell>
    </AppRuntimeProviders>
  );
}
