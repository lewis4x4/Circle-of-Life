import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export const metadata: Metadata = {
  title: "Medication reconciliation",
};

export default function DischargePipelineLayout({ children }: { children: ReactNode }) {
  // The med-rec hub calls useHavenAuth() for `updated_by` attribution; that
  // hook throws when its provider is missing. The pipeline route lives
  // outside the (admin) segment, so we mount the provider here directly.
  //
  // AppRuntimeProviders wraps it because that is where the forced password-change
  // gate lives; this was the one authenticated layout without it (COL-362).
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>{children}</HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
