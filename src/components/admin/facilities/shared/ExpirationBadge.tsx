"use client";

import React from "react";
import { Calendar, AlertCircle } from "lucide-react";

interface ExpirationBadgeProps {
  expirationDate: string | null;
  yellowDays?: number;
  redDays?: number;
}

export function ExpirationBadge({ expirationDate, yellowDays = 90, redDays = 30 }: ExpirationBadgeProps) {
  if (!expirationDate) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
        <Calendar className="h-3 w-3" />
        No expiration
      </span>
    );
  }

  const expirationTime = new Date(expirationDate).getTime();
  const nowTime = new Date().getTime();
  const daysUntilExpiration = Math.floor((expirationTime - nowTime) / (1000 * 60 * 60 * 24));

  let bgClass = "bg-green-100 text-green-800"; // > yellowDays
  let icon = null;

  if (daysUntilExpiration < 0) {
    bgClass = "bg-red-100 text-red-800";
    icon = <AlertCircle className="h-3 w-3" />;
  } else if (daysUntilExpiration <= redDays) {
    bgClass = "bg-red-100 text-red-800";
    icon = <AlertCircle className="h-3 w-3" />;
  } else if (daysUntilExpiration <= yellowDays) {
    bgClass = "bg-yellow-100 text-yellow-800";
    icon = <Calendar className="h-3 w-3" />;
  } else {
    icon = <Calendar className="h-3 w-3" />;
  }

  const formatDate = new Date(expirationDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${bgClass}`}>
      {icon}
      {daysUntilExpiration < 0 ? "Expired" : `Expires ${formatDate}`}
    </span>
  );
}
