import { AppShell } from "@/components/layout/AppShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // HavenAuthProvider is provided by the (admin) route-group layout above, so
  // it is intentionally not re-mounted here — AppShell consumes that context.
  return <AppShell>{children}</AppShell>;
}
