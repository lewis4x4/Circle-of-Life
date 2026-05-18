"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FormCancelLinkProps = {
  href: string;
  children?: ReactNode;
  className?: string;
};

/** Ghost cancel control for form footers (shared Quiet Operator pattern). */
export function FormCancelLink({ href, children = "Cancel", className }: FormCancelLinkProps) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[13px]", className)}
    >
      {children}
    </Link>
  );
}
