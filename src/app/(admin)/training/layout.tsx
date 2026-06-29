import type { ReactNode } from "react";

import { QueryClientLayout } from "@/components/layout/query-client-layout";

export default function TrainingLayout({ children }: { children: ReactNode }) {
  return <QueryClientLayout>{children}</QueryClientLayout>;
}
