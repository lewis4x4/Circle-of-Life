import { AppShell } from "@/components/layout/AppShell";
import { LazyOverlayShells } from "@/components/layout/LazyOverlayShells";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HavenAuthProvider>
      <AppShell>
        {children}
        <LazyOverlayShells />
      </AppShell>
    </HavenAuthProvider>
  );
}
