"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * HorizontalScroll — the one way wide content (tables, row lists, tab strips)
 * fits a narrow screen (COL-657).
 *
 * Content wider than its box scrolls sideways inside it instead of being cut
 * off by a card's `overflow-hidden`. While there is more to see, an edge
 * shade marks the side it is on, and the viewport becomes a named,
 * keyboard-focusable region so arrow keys reach every column (WCAG
 * scrollable-region-focusable). When everything fits, it is a plain box —
 * no tab stop, no shade.
 */
export function HorizontalScroll({
  label,
  className,
  viewportClassName,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Accessible name for the scroll region, e.g. "Staff roster". */
  label: string;
  viewportClassName?: string;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const max = viewport.scrollWidth - viewport.clientWidth;
      const next = { start: viewport.scrollLeft > 1, end: max - viewport.scrollLeft > 1 };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    for (const child of Array.from(viewport.children)) observer?.observe(child);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  const overflowing = edges.start || edges.end;

  return (
    <div
      data-slot="horizontal-scroll"
      data-overflowing={overflowing || undefined}
      className={cn("relative w-full min-w-0", className)}
      {...props}
    >
      <div
        ref={viewportRef}
        data-slot="horizontal-scroll-viewport"
        role={overflowing ? "region" : undefined}
        aria-label={overflowing ? label : undefined}
        tabIndex={overflowing ? 0 : undefined}
        className={cn(
          "w-full overflow-x-auto overscroll-x-contain",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          viewportClassName,
        )}
      >
        {children}
      </div>
      <span
        aria-hidden
        data-slot="horizontal-scroll-shade-start"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-foreground/15 to-transparent",
          "transition-opacity duration-[var(--motion-duration-micro)]",
          edges.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        data-slot="horizontal-scroll-shade-end"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-foreground/15 to-transparent",
          "transition-opacity duration-[var(--motion-duration-micro)]",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
