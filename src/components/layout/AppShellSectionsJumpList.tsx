"use client";

import { useCallback, useMemo, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  allSectionJumpEntries,
  sectionJumpQuickEntries,
  type Pillar,
  type SectionJumpEntry,
} from "@/lib/navigation/pillars";
import { cn } from "@/lib/utils";

function entrySearchValue(entry: SectionJumpEntry): string {
  const parts = [entry.label, entry.href, entry.pillarLabel ?? "", entry.group].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function matchesQuery(entry: SectionJumpEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return entrySearchValue(entry).includes(normalized);
}

export function AppShellSectionsJumpList({
  pillars,
  onSelect,
  triggerClassName,
}: {
  pillars: Pillar[];
  onSelect: (href: string) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allEntries = useMemo(() => allSectionJumpEntries(pillars), [pillars]);
  const quickEntries = useMemo(() => sectionJumpQuickEntries(pillars), [pillars]);

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const visibleEntries = useMemo(() => {
    if (!isSearching) return quickEntries;
    return allEntries.filter((entry) => matchesQuery(entry, trimmedSearch));
  }, [allEntries, isSearching, quickEntries, trimmedSearch]);

  const resetSurface = useCallback(() => {
    setSearch("");
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) resetSurface();
    },
    [resetSurface],
  );

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      resetSurface();
      onSelect(href);
    },
    [onSelect, resetSurface],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label="Open all sections menu"
        aria-expanded={open}
        className={cn(triggerClassName)}
      >
        <MenuIcon className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(22rem,calc(100vw-1rem))] p-0 sm:w-72"
        data-testid="all-sections-jump-list"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            placeholder="Jump to a section…"
            autoFocus
            value={search}
            onValueChange={setSearch}
            aria-label="Filter sections"
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading={isSearching ? "Sections" : "Common"}>
              {visibleEntries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <CommandItem
                    key={`${entry.group}-${entry.key}`}
                    value={entrySearchValue(entry)}
                    onSelect={() => handleSelect(entry.href)}
                    className="cursor-pointer"
                  >
                    <Icon className="text-muted-foreground" aria-hidden />
                    <span>{entry.label}</span>
                    {entry.pillarLabel ? (
                      <CommandShortcut>{entry.pillarLabel}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
