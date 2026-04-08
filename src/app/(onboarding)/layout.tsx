import { OnboardingShell } from "@/components/layout/OnboardingShell";

export default function OnboardingRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
