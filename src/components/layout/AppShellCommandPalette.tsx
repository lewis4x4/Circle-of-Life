"use client";

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
import { AUXILIARY_ROUTES, PILLARS } from "@/lib/navigation/pillars";

export function AppShellCommandPalette({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (href: string) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to any page, resident, staff member, or incident."
      className="sm:max-w-[560px]"
    >
      <Command shouldFilter loop>
        <CommandInput placeholder="Search residents, staff, incidents, routes…" autoFocus />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {PILLARS.map((pillar) => (
            <CommandGroup key={pillar.id} heading={pillar.label}>
              {pillar.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={`${pillar.id}-${item.key}`}
                    value={`${pillar.label} ${item.label} ${item.href}`}
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
          <CommandGroup heading="Finance & Settings">
            {AUXILIARY_ROUTES.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={`aux-${item.key}`}
                  value={`${item.label} ${item.href}`}
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
