"use client";

import React from "react";

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
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-[2px] ${
            activeTab === tab.id
              ? "border-teal-500 text-teal-600 bg-teal-50"
              : "border-transparent text-muted-foreground hover:text-gray-900 hover:bg-gray-50"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
