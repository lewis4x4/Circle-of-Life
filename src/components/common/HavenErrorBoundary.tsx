"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type HavenErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type HavenErrorBoundaryState = {
  hasError: boolean;
};

export class HavenErrorBoundary extends Component<HavenErrorBoundaryProps, HavenErrorBoundaryState> {
  state: HavenErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): HavenErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("HavenErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
