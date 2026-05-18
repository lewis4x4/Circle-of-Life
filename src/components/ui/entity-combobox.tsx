"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type EntityComboboxOption = {
  id: string;
  /** Primary line (e.g. resident name). */
  label: string;
  /** Shown smaller on the option row; optional. */
  meta?: string;
  /** Combined string for filtering. */
  keywords: string;
};

export type EntityComboboxProps = {
  id: string;
  label: ReactNode;
  placeholder: string;
  searchPlaceholder?: string;
  options: EntityComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  required?: boolean;
  "data-testid"?: string;
};

/**
 * Focusable combobox (Command + Popover) for entity pickers — opens on focus for fast keyboard flow.
 */
export function EntityCombobox({
  id,
  label,
  placeholder,
  searchPlaceholder = "Search…",
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
  className,
  triggerClassName,
  required,
  "data-testid": dataTestId,
}: EntityComboboxProps) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-[13px] font-semibold text-muted-foreground">
        {label}
        {required ? <span className="font-semibold text-destructive"> *</span> : null}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled || loading}
          data-testid={dataTestId}
          aria-required={required}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-10 w-full justify-between px-3 font-normal shadow-none",
            triggerClassName,
          )}
          onFocus={() => {
            if (!disabled && !loading) setOpen(true);
          }}
        >
          <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
            {loading ? "Loading…" : selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
          <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.keywords} ${opt.id}`}
                    onSelect={() => {
                      onChange(opt.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 size-4 shrink-0", value === opt.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13px]">{opt.label}</span>
                      {opt.meta ? (
                        <span className="truncate text-[12px] text-muted-foreground">{opt.meta}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
