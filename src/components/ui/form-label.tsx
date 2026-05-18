"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FormLabelProps = React.ComponentPropsWithoutRef<typeof Label> & {
  required?: boolean;
};

/** Quiet Operator form label with optional required marker. */
export function FormLabel({ className, children, required, ...props }: FormLabelProps) {
  return (
    <Label
      className={cn("text-[13px] font-semibold normal-case tracking-normal text-muted-foreground", className)}
      {...props}
    >
      {children}
      {required ? <span className="font-semibold text-destructive"> *</span> : null}
    </Label>
  );
}
