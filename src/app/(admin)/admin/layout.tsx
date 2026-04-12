import { AdminShell } from "@/components/layout/AdminShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";
import { GraceShell } from "@/lib/grace/GraceShell";
import { HavenInsightShell } from "@/components/haven-insight/HavenInsightShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <AdminShell>
        {children}
        <GraceShell />
        <HavenInsightShell />
      </AdminShell>
    </HavenAuthProvider>
  );
}
