import { cn } from "@/lib/utils";
import React from "react";

interface KineticGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Deprecated — kept for signature compatibility, ignored. */
  staggerMs?: number;
  /** Deprecated — kept for signature compatibility, ignored. */
  baseDelayMs?: number;
}

/**
 * Audit-defanged: was a CSS-staggered fade-in/slide-in grid (`animate-in
 * fade-in slide-in-from-bottom-4` with per-child `animationDelay`).
 * Renders a plain `<div className="grid …">` so consumers keep their
 * grid layout but no longer animate on mount.
 */
export function KineticGrid({
  children,
  className,
  staggerMs: _staggerMs,
  baseDelayMs: _baseDelayMs,
  ...props
}: KineticGridProps) {
  void _staggerMs;
  void _baseDelayMs;
  return (
    <div className={cn("grid min-w-0", className)} {...props}>
      {children}
    </div>
  );
}
