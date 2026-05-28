import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { CaregiverShell } from "@/components/layout/CaregiverShell";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

/**
 * Caregiver portal — hard-locked to the Quiet Operator dark theme regardless
 * of the user's admin toggle. Caregiver shifts include night rotations
 * (11P–7A) and bedside use in dim resident rooms; a light flash mid-shift
 * is both glare-painful and a clinical-misread risk.
 *
 * The `dark` class on this wrapper ensures the operator-dark tokens win even
 * when the user previously toggled admin to light, because CSS variable
 * cascade follows the nearest enclosing class.
 */
export default function CaregiverRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <div className="dark">
          <CaregiverShell>{children}</CaregiverShell>
        </div>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
