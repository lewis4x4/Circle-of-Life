"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";

export function Sparkline({ colorClass = "text-indigo-500", variant = 1, className }: { colorClass?: string, variant?: number, className?: string }) {
  const paths = {
    1: { fill: "M0 25 L15 15 L30 20 L45 5 L60 12 L75 2 L100 10 L100 30 L0 30 Z", stroke: "M0 25 L15 15 L30 20 L45 5 L60 12 L75 2 L100 10" },
    2: { fill: "M0 10 L20 18 L40 5 L60 22 L80 15 L100 5 L100 30 L0 30 Z", stroke: "M0 10 L20 18 L40 5 L60 22 L80 15 L100 5" },
    3: { fill: "M0 20 L25 22 L50 15 L75 18 L100 8 L100 30 L0 30 Z", stroke: "M0 20 L25 22 L50 15 L75 18 L100 8" },
    4: { fill: "M0 5 L20 10 L40 25 L60 15 L80 18 L100 5 L100 30 L0 30 Z", stroke: "M0 5 L20 10 L40 25 L60 15 L80 18 L100 5" },
  };
  const path = paths[variant as keyof typeof paths] || paths[1];
  const idValue = useId().replace(/:/g, "");

  return (
    <svg className={cn("absolute bottom-0 left-0 w-full h-14 opacity-15 group-hover:opacity-30 transition-opacity duration-500 pointer-events-none", colorClass, className)} viewBox="0 0 100 30" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${idValue}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.fill} fill={`url(#grad-${idValue})`} />
      <path d={path.stroke} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
