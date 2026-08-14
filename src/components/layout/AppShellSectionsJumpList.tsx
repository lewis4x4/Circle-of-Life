"use client";

import { useCallback, useMemo } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { PopoverContent } from "@/components/ui/popover";
import {
  allSectionJumpEntries,
  sectionJumpQuickEntries,
  type Pillar,
  type SectionJumpEntry,
} from "@/lib/navigation/pillars";
import { cn } from "@/lib/utils";

function entrySearchValue(entry: SectionJumpEntry): string {
  const parts = [entry.label, entry.href, entry.pillarLabel ?? ""].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function matchesQuery(entry: SectionJumpEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return entrySearchValue(entry).includes(normalized);
}

export function AppShellSectionsJumpListPanel({
  pillars,
  onSelect,
  search,
  onSearchChange,
  onOpenChange,
}: {
  pillars: Pillar[];
  onSelect: (href: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const allEntries = useMemo(() => allSectionJumpEntries(pillars), [pillars]);
  const quickEntries = useMemo(() => sectionJumpQuickEntries(pillars), [pillars]);

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const visibleEntries = useMemo(() => {
    if (!isSearching) return quickEntries;
    return allEntries.filter((entry) => matchesQuery(entry, trimmedSearch));
  }, [allEntries, isSearching, quickEntries, trimmedSearch]);

  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false);
      onSearchChange("");
      onSelect(href);
    },
    [onOpenChange, onSearchChange, onSelect],
  );

  return (
    <PopoverContent
      align="start"
      sideOffset={6}
      data-testid="all-sections-jump-list"
      className={cn(
        "w-[min(22rem,calc(100vw-1rem))] gap-0 p-0 sm:w-72",
      )}
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          placeholder="Jump to a section…"
          autoFocus
          value={search}
          onValueChange={onSearchChange}
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
  );
}
