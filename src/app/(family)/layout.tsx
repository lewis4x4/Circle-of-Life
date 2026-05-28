import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { FamilyShell } from "@/components/layout/FamilyShell";

/**
 * Family portal — hard-locked to the warm-paper light theme regardless of
 * the user's admin/caregiver toggle. Older residents and family members
 * read this on tablets in living-room lighting; consistent branding
 * outweighs personal theme preference here.
 *
 * The `light` class on this wrapper ensures the cream tokens win even when
 * a parent (`<html className="dark">`) is currently dark, because CSS
 * variable cascade follows the nearest enclosing class.
 */
export default function FamilyRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <div className="light">
        <FamilyShell>{children}</FamilyShell>
      </div>
    </AppRuntimeProviders>
  );
}
