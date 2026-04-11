"use client";

import { GraceBar } from "./GraceBar";
import { GraceCorner } from "./GraceCorner";
import { FlowEngineUI } from "./FlowEngineUI";
import { GraceUndoToast } from "./GraceUndoToast";
import { useGracePresenceState } from "./presence";
import { GraceStoreProvider, useGraceStore } from "./store";

function GraceShellInner() {
  const { state, openBar, toggleCollapsed } = useGraceStore();
  const presenceState = useGracePresenceState();

  return (
    <>
      <GraceCorner
        state={presenceState}
        onClick={openBar}
        collapsed={state.collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <GraceBar />
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
