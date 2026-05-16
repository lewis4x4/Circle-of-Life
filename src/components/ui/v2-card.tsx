import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Audit-defanged: was a `rounded-[2rem] backdrop-blur-3xl glass-card` with
 * a radial-hover bloom and top-glare shine. Per DESIGN_PRINCIPLES.md cards
 * are flat `rounded-lg border bg-card`. The `hoverColor` prop is accepted
 * for signature compatibility and ignored — every consumer renders the
 * same neutral card.
 */
export function V2Card({
  children,
  className,
  href,
  hoverColor: _hoverColor,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
  /** Deprecated — kept for signature compatibility. */
  hoverColor?: string;
}) {
  void _hoverColor;

  const content = (
    <div
      className={cn(
        "group relative flex h-full w-full flex-col gap-2 rounded-lg border border-border bg-card p-4",
        href && "transition-colors hover:bg-secondary/40",
        className,
      )}
    >
      {children}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "block h-full rounded-lg outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        )}
      >
        {content}
      </Link>
    );
  }
  return content;
}
