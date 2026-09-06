"use client";

import { useMemo } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { AUXILIARY_ROUTES, PILLARS, type Pillar, type PillarItem } from "@/lib/navigation/pillars";

export function AppShellCommandPalette({
  open,
  onOpenChange,
  onSelect,
  onPrefetch,
  pillars = PILLARS,
  auxiliary = AUXILIARY_ROUTES,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (href: string) => void;
  onPrefetch: (href: string) => void;
  pillars?: Pillar[];
  auxiliary?: PillarItem[];
}) {
  const hrefByValue = useMemo(() => {
    const entries = [
      ...pillars.flatMap((pillar) =>
        pillar.items.map((item) => [
          `${pillar.label} ${item.label} ${item.href}`,
          item.href,
        ] as const),
      ),
      ...auxiliary.map((item) => [
        `${item.label} ${item.href}`,
        item.href,
      ] as const),
    ];
    return new Map<string, string>(entries);
  }, [pillars, auxiliary]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Find a page"
      description="Find an available page by name."
      className="sm:max-w-[480px]"
    >
      <Command
        shouldFilter
        loop
        onValueChange={(value) => {
          const href = hrefByValue.get(value);
          if (href) onPrefetch(href);
        }}
      >
        <CommandInput placeholder="Find a page…" autoFocus />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {pillars.map((pillar) => (
            <CommandGroup key={pillar.id} heading={pillar.label}>
              {pillar.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={`${pillar.id}-${item.key}`}
                    value={`${pillar.label} ${item.label} ${item.href}`}
                    onPointerMove={() => onPrefetch(item.href)}
                    onFocus={() => onPrefetch(item.href)}
                    onSelect={() => onSelect(item.href)}
                  >
                    <Icon className="text-muted-foreground" aria-hidden />
                    <span>{item.label}</span>
                    <CommandShortcut>{pillar.label}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="More tools">
            {auxiliary.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={`aux-${item.key}`}
                  value={`${item.label} ${item.href}`}
                  onPointerMove={() => onPrefetch(item.href)}
                  onFocus={() => onPrefetch(item.href)}
                  onSelect={() => onSelect(item.href)}
                >
                  <Icon className="text-muted-foreground" aria-hidden />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
