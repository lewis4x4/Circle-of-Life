"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * BottomNav — mobile-first bottom tab bar primitive.
 *
 * Renders a fixed-position `<nav>` along the viewport bottom edge with
 * one `<BottomNavItem>` per primary destination. Designed for the
 * caregiver portal (the only Haven surface where mobile is the canonical
 * device, not the fallback), but reusable anywhere the same tab-bar
 * pattern appears.
 *
 * Sizing + safe area:
 *   - Container height: `h-14` (56px) bumped by `env(safe-area-inset-bottom)`
 *     so the bar clears the iPhone home-indicator strip.
 *   - Each item is `min-h-11` (44px) to meet the iOS HIG minimum touch
 *     target, even though the parent is taller — the parent contains
 *     padding for the label.
 *
 * Theming (Quiet Operator):
 *   - Solid `bg-background` chrome. NO backdrop-blur, NO translucency —
 *     glassmorphism is the top anti-pattern (anti-patterns.md).
 *   - Inactive items use `text-muted-foreground`; hover/active touch
 *     state flips to `text-foreground`.
 *   - The ACTIVE item renders in `text-primary` AND draws a 2px brand
 *     accent bar across the top edge (`::after`). This is the Linear /
 *     Mercury pattern: calm neutral chrome, brand cue ONLY at the active
 *     indicator. No `bg-accent` fill — `--accent` is the muted chip slot,
 *     not a brand emphasis.
 *
 * Hover discipline:
 *   Every `hover:` utility ships with an equivalent `active:` for touch
 *   devices that never fire hover. The CI guardrail in
 *   `.github/workflows/style-regression.yml` enforces this on the
 *   caregiver route group.
 *
 * Usage:
 *   <BottomNav aria-label="Caregiver navigation">
 *     <BottomNavItem href="/caregiver" icon={<Home className="h-5 w-5" />} label="Home" active={pathname === "/caregiver"} />
 *     <BottomNavItem href="/caregiver/meds" icon={<Pill className="h-5 w-5" />} label="Meds" active={pathname.startsWith("/caregiver/meds")} />
 *   </BottomNav>
 *
 * The primitive intentionally does NOT compute `active` for the consumer.
 * Routing is the page's concern — primitive handles chrome only.
 */

type BottomNavProps = React.HTMLAttributes<HTMLElement> & {
  "aria-label": string;
  children: React.ReactNode;
};

export function BottomNav({ className, children, ...props }: BottomNavProps) {
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-border bg-background px-2 pb-[env(safe-area-inset-bottom)] pt-1",
        className,
      )}
      {...props}
    >
      {children}
    </nav>
  );
}

type BottomNavItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
};

export function BottomNavItem({ href, label, icon, active = false }: BottomNavItemProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "relative inline-flex min-h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-[state=active]:text-primary",
        "data-[state=active]:after:pointer-events-none data-[state=active]:after:absolute data-[state=active]:after:left-2 data-[state=active]:after:right-2 data-[state=active]:after:top-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary",
        "data-[state=inactive]:text-muted-foreground",
        "hover:text-foreground active:text-foreground",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
