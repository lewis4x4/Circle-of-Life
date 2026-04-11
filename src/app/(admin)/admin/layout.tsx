import { AdminShell } from "@/components/layout/AdminShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";
import { GraceShell } from "@/lib/grace/GraceShell";

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
      </AdminShell>
    </HavenAuthProvider>
  );
}
