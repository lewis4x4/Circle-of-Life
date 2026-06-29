import type { ReactNode } from "react";

import { QueryClientLayout } from "@/components/layout/query-client-layout";

export default function StandupHistoryLayout({ children }: { children: ReactNode }) {
  return <QueryClientLayout>{children}</QueryClientLayout>;
}
