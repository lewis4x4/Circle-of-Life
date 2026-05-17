"use client";

import { useCallback, useEffect, useState } from "react";
import { GraceBar } from "./GraceBar";
import { FlowEngineUI } from "./FlowEngineUI";
import { GraceUndoToast } from "./GraceUndoToast";
import { GraceStoreProvider, useGraceStore } from "./store";

function GraceShellInner() {
  const { state, openBar, closeBar } = useGraceStore();
  const [panelOpen, setPanelOpen] = useState(false);

  const openGrace = useCallback(() => {
    openBar();
    setPanelOpen(true);
  }, [openBar]);

  const closeGrace = useCallback(() => {
    closeBar();
    setPanelOpen(false);
  }, [closeBar]);

  useEffect(() => {
    const onOpenGrace = () => openGrace();
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? event.metaKey : event.ctrlKey;
      if (cmd && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (panelOpen) closeGrace();
        else openGrace();
      }
    };
    window.addEventListener("grace:open", onOpenGrace);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("grace:open", onOpenGrace);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeGrace, openGrace, panelOpen]);

  return (
    <>
      <GraceBar open={panelOpen} onClose={closeGrace} />
      {state.activeFlow ? <FlowEngineUI /> : null}
      <GraceUndoToast />
    </>
  );
}

export function GraceShell() {
  return (
    <GraceStoreProvider>
      <GraceShellInner />
    </GraceStoreProvider>
  );
}
