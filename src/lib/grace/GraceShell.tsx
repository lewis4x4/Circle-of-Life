"use client";

import { useCallback, useEffect, useState } from "react";
import { GraceBar } from "./GraceBar";
import { FlowEngineUI } from "./FlowEngineUI";
import { GraceUndoToast } from "./GraceUndoToast";
import { GraceStoreProvider, useGraceStore } from "./store";

type GraceShellInnerProps = {
  openRequestToken?: number;
  toggleRequestToken?: number;
};

function GraceShellInner({ openRequestToken, toggleRequestToken }: GraceShellInnerProps) {
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
    if (openRequestToken == null || openRequestToken < 1) return undefined;
    const timer = window.setTimeout(openGrace, 0);
    return () => window.clearTimeout(timer);
  }, [openGrace, openRequestToken]);

  useEffect(() => {
    if (toggleRequestToken == null || toggleRequestToken < 1) return undefined;
    const timer = window.setTimeout(() => {
      if (panelOpen) closeGrace();
      else openGrace();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [closeGrace, openGrace, panelOpen, toggleRequestToken]);

  return (
    <>
      <GraceBar open={panelOpen} onClose={closeGrace} />
      {state.activeFlow ? <FlowEngineUI /> : null}
      <GraceUndoToast />
    </>
  );
}

type GraceShellProps = {
  openRequestToken?: number;
  toggleRequestToken?: number;
};

export function GraceShell({ openRequestToken, toggleRequestToken }: GraceShellProps) {
  return (
    <GraceStoreProvider>
      <GraceShellInner
        openRequestToken={openRequestToken}
        toggleRequestToken={toggleRequestToken}
      />
    </GraceStoreProvider>
  );
}
