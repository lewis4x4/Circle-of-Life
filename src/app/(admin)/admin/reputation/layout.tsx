import type { ReactNode } from "react";

import { QueryClientLayout } from "@/components/layout/query-client-layout";

export default function AdminReputationLayout({ children }: { children: ReactNode }) {
  return <QueryClientLayout>{children}</QueryClientLayout>;
}
