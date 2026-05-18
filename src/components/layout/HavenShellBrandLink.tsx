"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Typography-only Haven wordmark (Geist Sans via `--font-sans`).
 * Leading H at 700, “aven” at 600 — subtle Mercury-style emphasis without an icon/mark.
 *
 * Shell chrome sets `color` on the wrapping Link (`text-foreground`, `haven-chrome-fg`, etc.).
 */
const WORDMARK_CLASSES =
  "font-sans text-[14px] leading-none tracking-[-0.01em] inline-flex items-center whitespace-nowrap text-inherit";

export type HavenShellBrandLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  /** e.g. AdminShell role pill — wrap with ml-auto where needed */
  children?: ReactNode;
};

export function HavenShellBrandLink({ className, children, ...props }: HavenShellBrandLinkProps) {
  return (
    <Link className={cn("flex min-h-9 items-center gap-3", className)} {...props}>
      <span className={WORDMARK_CLASSES}>
        <span className="font-bold">H</span>
        <span className="font-semibold">aven</span>
      </span>
      {children}
    </Link>
  );
}
