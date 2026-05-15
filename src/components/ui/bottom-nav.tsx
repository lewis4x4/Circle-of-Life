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
 * Theming:
 *   Backgrounds use semantic tokens (`bg-background/95` with a
 *   `backdrop-blur` fallback) so it inverts cleanly between light + dark.
 *   Active items use `bg-accent text-accent-foreground`; inactive items
 *   use `text-muted-foreground` with `active:` pressed-state feedback.
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
        "fixed inset-x-0 bottom-0 z-50 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-border bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80",
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
        "inline-flex min-h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-[state=active]:bg-accent data-[state=active]:text-accent-foreground",
        "data-[state=inactive]:text-muted-foreground",
        "hover:text-foreground active:text-foreground",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
