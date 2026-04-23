import { AdminShell } from "@/components/layout/AdminShell";
import { LazyOverlayShells } from "@/components/layout/LazyOverlayShells";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <AdminShell>
        {children}
        <LazyOverlayShells />
      </AdminShell>
    </HavenAuthProvider>
  );
}
