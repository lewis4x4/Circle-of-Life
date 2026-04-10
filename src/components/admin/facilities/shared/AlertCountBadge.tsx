"use client";

import React from "react";
import { AlertCircle } from "lucide-react";

interface AlertCountBadgeProps {
  count: number;
  severity: "red" | "yellow";
}

export function AlertCountBadge({ count, severity }: AlertCountBadgeProps) {
  if (count === 0) {
    return null;
  }

  const bgClass = severity === "red" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700";

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${bgClass}`}>
      <AlertCircle className="h-3 w-3" />
      <span>{count}</span>
    </div>
  );
}
