"use client";

import { HavenInsightProvider } from "@/lib/haven-insight/HavenInsightContext";
import { HavenInsightPanel } from "./HavenInsightPanel";
import { HavenInsightTrigger } from "./HavenInsightTrigger";

export function HavenInsightShell() {
  return (
    <HavenInsightProvider>
      <HavenInsightTrigger />
      <HavenInsightPanel />
    </HavenInsightProvider>
  );
}
