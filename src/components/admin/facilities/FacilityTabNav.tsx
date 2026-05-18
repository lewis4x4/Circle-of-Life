"use client";

import React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { FACILITY_PRIMARY_TAB_COUNT } from "@/lib/admin/facilities/facility-constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";

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
  const primary = tabs.slice(0, FACILITY_PRIMARY_TAB_COUNT);
  const overflow = tabs.slice(FACILITY_PRIMARY_TAB_COUNT);

  return (
    <div className="flex min-w-0 items-stretch gap-1 overflow-x-auto scrollbar-hide">
      {primary.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "relative shrink-0 whitespace-nowrap px-4 py-3 text-[13px] font-medium transition-colors sm:px-6",
            "border-b-2 -mb-px rounded-none",
            activeTab === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}

      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "shrink-0 gap-1.5 self-center rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground",
              overflow.some((t) => t.id === activeTab) && "border-primary text-foreground",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {overflow.map((tab) => (
              <DropdownMenuItem key={tab.id} onClick={() => onTabChange(tab.id)}>
                {tab.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
