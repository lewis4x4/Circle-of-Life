import type { Metadata } from "next";
import type { ReactNode } from "react";

import { HavenAuthProvider } from "@/contexts/haven-auth-context";

export const metadata: Metadata = {
  title: "Medication reconciliation",
};

export default function DischargePipelineLayout({ children }: { children: ReactNode }) {
  // The med-rec hub calls useHavenAuth() for `updated_by` attribution; that
  // hook throws when its provider is missing. The pipeline route lives
  // outside the (admin) segment, so we mount the provider here directly.
  return <HavenAuthProvider>{children}</HavenAuthProvider>;
}
