"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** Section title — sentence case, Geist Sans via inheritance, no uppercase / tracking hacks. */
export function SectionLabel({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[14px] font-semibold leading-snug tracking-normal text-foreground", className)}
      {...rest}
    >
      {children}
    </h3>
  );
}

/** Field / column label — muted helper tone. */
export function FieldLabel({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-[12px] font-medium leading-snug tracking-normal text-muted-foreground", className)} {...rest}>
      {children}
    </p>
  );
}
