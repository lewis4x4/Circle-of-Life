"use client";

import { MessageSquare } from "lucide-react";
import type { GraceAvatarState } from "./types";

export interface GraceAvatarProps {
  state: GraceAvatarState;
  size?: number;
  collapsed?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

const STATE_TO_LABEL: Record<GraceAvatarState, string> = {
  idle: "Grace ready",
  thinking: "Grace thinking",
  speaking: "Grace speaking",
  listening: "Grace listening",
  alert: "Grace alert",
  flow_active: "Grace flow in progress",
  success: "Grace completed action",
};

function stateClassName(state: GraceAvatarState): string {
  switch (state) {
    case "alert":
      return "border-warning/40 text-warning";
    case "listening":
    case "thinking":
    case "flow_active":
    case "speaking":
      return "border-primary/40 text-primary";
    case "success":
      return "border-success/40 text-success";
    default:
      return "border-border text-muted-foreground";
  }
}

export function GraceAvatar({
  state,
  size = 72,
  collapsed = false,
  onClick,
  ariaLabel,
  className = "",
}: GraceAvatarProps) {
  const label = ariaLabel ?? STATE_TO_LABEL[state];
  const effectiveSize = collapsed ? 32 : Math.min(size, 44);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-full border bg-card shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${stateClassName(state)} ${className}`}
      style={{ width: effectiveSize, height: effectiveSize }}
    >
      <MessageSquare className={collapsed ? "size-3.5" : "size-4"} aria-hidden />
      {state === "alert" && !collapsed && (
        <span
          aria-hidden
          className="absolute right-1 top-1 size-2 rounded-full bg-warning"
        />
      )}
    </button>
  );
}
