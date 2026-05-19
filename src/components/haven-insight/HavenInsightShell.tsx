"use client";

import { useEffect } from "react";
import { HavenInsightProvider, useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";
import { HavenInsightPanel } from "./HavenInsightPanel";

type HavenInsightShellInnerProps = {
  openRequestToken?: number;
  toggleRequestToken?: number;
};

function HavenInsightShellInner({ openRequestToken, toggleRequestToken }: HavenInsightShellInnerProps) {
  const { open, close, isOpen } = useHavenInsight();

  useEffect(() => {
    if (openRequestToken == null || openRequestToken < 1) return undefined;
    const timer = window.setTimeout(open, 0);
    return () => window.clearTimeout(timer);
  }, [open, openRequestToken]);

  useEffect(() => {
    if (toggleRequestToken == null || toggleRequestToken < 1) return undefined;
    const timer = window.setTimeout(() => {
      if (isOpen) close();
      else open();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [close, isOpen, open, toggleRequestToken]);

  return <HavenInsightPanel />;
}

type HavenInsightShellProps = {
  openRequestToken?: number;
  toggleRequestToken?: number;
};

export function HavenInsightShell({
  openRequestToken,
  toggleRequestToken,
}: HavenInsightShellProps) {
  return (
    <HavenInsightProvider>
      <HavenInsightShellInner
        openRequestToken={openRequestToken}
        toggleRequestToken={toggleRequestToken}
      />
    </HavenInsightProvider>
  );
}
