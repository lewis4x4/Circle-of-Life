"use client";

import { useCallback, useMemo, type RefObject } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
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
  open,
  onOpenChange,
  anchorRef,
  pillars,
  onSelect,
  search,
  onSearchChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  pillars: Pillar[];
  onSelect: (href: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
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
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchorRef}
          align="start"
          sideOffset={6}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            data-testid="all-sections-jump-list"
            className={cn(
              "z-50 flex w-[min(22rem,calc(100vw-1rem))] origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 sm:w-72",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
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
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
