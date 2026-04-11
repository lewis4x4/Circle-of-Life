import { AdminShell } from "@/components/layout/AdminShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <AdminShell>{children}</AdminShell>
    </HavenAuthProvider>
  );
}
