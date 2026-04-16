import { CaregiverShell } from "@/components/layout/CaregiverShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function CaregiverRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <CaregiverShell>{children}</CaregiverShell>
    </HavenAuthProvider>
  );
}
