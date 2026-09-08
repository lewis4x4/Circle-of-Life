"use client";

import React from "react";
import { Menu as MenuIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Pillar } from "@/lib/navigation/pillars";
import { cn } from "@/lib/utils";

/**
 * AllSectionsMenu — the "Open all sections menu" mega-menu in the AppShell top
 * bar. Lists every visible pillar, each pillar's label followed by its items.
 *
 * Each pillar renders as a base-ui `Menu.Group` (DropdownMenuGroup) whose
 * `Menu.GroupLabel` (DropdownMenuLabel) MUST sit *inside* the group — a
 * GroupLabel outside a Group throws base-ui error #31 at runtime
 * (`useMenuGroupRootContext` throws when the context is missing). Dev tolerates
 * the misuse; the production build crashes the page to the error boundary the
 * moment the menu opens. See AllSectionsMenu.test.tsx for the regression guard.
 */
export function AllSectionsMenu({
  pillars,
  onNavigate,
  triggerClassName,
}: {
  pillars: Pillar[];
  onNavigate: (href: string) => void;
  triggerClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open all sections menu"
        className={cn(
          triggerClassName,
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <MenuIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[min(22rem,calc(100vw-1rem))] sm:w-72"
      >
        {pillars.map((pillar, pillarIdx) => (
          <React.Fragment key={pillar.id}>
            {pillarIdx > 0 && <DropdownMenuSeparator />}
            {/* GroupLabel is a base-ui "group part" and MUST sit inside a Group,
                or base-ui throws error #31 at runtime (dev tolerates it, prod crashes). */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {React.createElement(pillar.icon, { className: "size-3.5", "aria-hidden": true })}
                {pillar.label}
              </DropdownMenuLabel>
              {pillar.items.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={item.key}
                    onClick={() => onNavigate(item.href)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
                  >
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AllSectionsMenu;
