import React from "react";
import { cn } from "@/lib/utils";

export function PulseDot({ colorClass = "bg-rose-500", className }: { colorClass?: string, className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)}>
      <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", colorClass)}></span>
      <span className={cn("relative inline-flex rounded-full h-2 w-2", colorClass)}></span>
    </span>
  );
}
