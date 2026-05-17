"use client";

import { useEffect } from "react";
import { HavenInsightProvider, useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";
import { HavenInsightPanel } from "./HavenInsightPanel";

function HavenInsightShellInner() {
  const { open, close, isOpen } = useHavenInsight();

  useEffect(() => {
    const onOpen = () => open();
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? event.metaKey : event.ctrlKey;
      if (cmd && event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (isOpen) close();
        else open();
      }
    };
    window.addEventListener("haven-insight:open", onOpen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("haven-insight:open", onOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, isOpen, open]);

  return <HavenInsightPanel />;
}

export function HavenInsightShell() {
  return (
    <HavenInsightProvider>
      <HavenInsightShellInner />
    </HavenInsightProvider>
  );
}
