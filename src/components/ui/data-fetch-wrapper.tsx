"use client";

import type { ReactNode } from "react";

export type DataFetchState = "idle" | "loading" | "error" | "success-empty" | "success-populated";

export type DataFetchWrapperProps = {
  state: DataFetchState;
  idle?: ReactNode;
  loading?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
};

/** Explicit data-fetch state machine: renders exactly one UI state at a time. */
export function DataFetchWrapper({ state, idle = null, loading, error, empty, children }: DataFetchWrapperProps) {
  if (state === "idle") return <>{idle}</>;
  if (state === "loading") return <>{loading ?? null}</>;
  if (state === "error") return <>{error ?? null}</>;
  if (state === "success-empty") return <>{empty ?? null}</>;
  return <>{children}</>;
}
