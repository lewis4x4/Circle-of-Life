"use client";

import React from "react";

interface OccupancyGaugeProps {
  occupied: number;
  total: number;
  size?: "sm" | "lg";
}

export function OccupancyGauge({ occupied, total, size = "sm" }: OccupancyGaugeProps) {
  const percentage = total > 0 ? (occupied / total) * 100 : 0;

  // Determine color based on occupancy
  let colorClass = "bg-green-500"; // < 90%
  if (percentage >= 90 && percentage < 95) {
    colorClass = "bg-yellow-500"; // 90-95%
  } else if (percentage >= 95) {
    colorClass = "bg-red-500"; // >= 95%
  }

  if (size === "lg") {
    // Large circular gauge
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (percentage / 100) * circumference;

    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-32 h-32">
          <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-gray-200"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={`transition-all duration-500 ${colorClass} text-current`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-3xl font-bold">{Math.round(percentage)}%</div>
              <div className="text-xs text-muted-foreground">
                {occupied}/{total}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Small bar gauge
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-sm font-medium">{occupied}/{total} beds</span>
        <span className="text-muted-foreground">{Math.round(percentage)}%</span>
      </div>
      <div className="relative h-2 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${colorClass}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
