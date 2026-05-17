import { AppShell } from "@/components/layout/AppShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <AppShell>{children}</AppShell>
    </HavenAuthProvider>
  );
}
