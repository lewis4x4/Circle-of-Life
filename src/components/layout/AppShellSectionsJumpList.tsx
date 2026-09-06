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
  type Pillar,
  type PillarItem,
  AUXILIARY_ROUTES,
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

export function AppShellSectionsJumpListPanel({
  pillars,
  auxiliary = AUXILIARY_ROUTES,
  onSelect,
  search,
  onSearchChange,
  onOpenChange,
}: {
  pillars: Pillar[];
  auxiliary?: PillarItem[];
  onSelect: (href: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const allEntries = useMemo(() => allSectionJumpEntries(pillars, auxiliary), [pillars, auxiliary]);

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const visibleEntries = useMemo(() => {
    if (!isSearching) return allEntries;
    return allEntries.filter((entry) => matchesQuery(entry, trimmedSearch));
  }, [allEntries, isSearching, trimmedSearch]);

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
          placeholder="Search all sections…"
          autoFocus
          value={search}
          onValueChange={onSearchChange}
          aria-label="Search or jump to a section"
        />
        {!isSearching ? (
          <p className="px-3 pb-1 text-[11px] text-muted-foreground">
            Available pages for your role. Type to filter.
          </p>
        ) : null}
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Available pages">
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
