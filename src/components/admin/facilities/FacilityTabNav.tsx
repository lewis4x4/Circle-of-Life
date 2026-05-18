"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TabConfig {
  id: string;
  label: string;
}

interface FacilityTabNavProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  tabs: TabConfig[];
}

export function FacilityTabNav({ activeTab, onTabChange, tabs }: FacilityTabNavProps) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "relative whitespace-nowrap px-6 py-3 text-[13px] font-medium transition-colors",
            "border-b-2 -mb-px rounded-none",
            activeTab === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
