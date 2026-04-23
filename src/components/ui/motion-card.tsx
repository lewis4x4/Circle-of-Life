import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Pure-CSS drop-in replacement for the framer-motion wrapper this file used
// to export. Same API (children, className, delay). The delay prop is
// respected via inline animationDelay so callers that orchestrate a stagger
// still work. Dropping framer-motion here (paired with motion-list.tsx)
// removes the library from every admin-page bundle that only used these
// wrappers for mount animations.

export function MotionCard({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out fill-mode-both",
        className,
      )}
      style={delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
