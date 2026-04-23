import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Pure-CSS drop-in for the framer-motion wrapper this file used to export.
// The animation uses tw-animate-css utilities (already in the project); items
// fade + rise on mount. Dropping framer-motion here removes ~100KB of JS
// from every admin page bundle that imports MotionList / MotionItem. No
// staggered delay — visual difference is marginal, and the cost/benefit
// doesn't justify carrying framer-motion for a stagger effect.

export function MotionList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(className)}>{children}</div>;
}

export function MotionItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out fill-mode-both",
        className,
      )}
    >
      {children}
    </div>
  );
}
