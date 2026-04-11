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
          className={`px-6 py-4 text-[11px] font-mono tracking-widest uppercase font-semibold whitespace-nowrap transition-all border-b-[3px] -mb-[1px] relative top-[1px] ${
            activeTab === tab.id
              ? "border-teal-500 text-teal-700 dark:text-teal-300 bg-teal-50/50 dark:bg-teal-500/10"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-amber-100 hover:bg-slate-50/50 dark:hover:bg-white/5"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
