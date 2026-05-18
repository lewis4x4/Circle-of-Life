"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FacilityFormSelect<T extends string>(props: {
  id?: string;
  label: string;
  placeholder: string;
  value: T | "";
  options: readonly { value: T; label: string }[];
  onValueChange: (next: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const { id, label, placeholder, value, options, onValueChange, disabled, hideLabel, className } = props;

  return (
    <div className={cn("space-y-2", className)}>
      {hideLabel ? null : <Label htmlFor={id}>{label}</Label>}
      <Select value={value || undefined} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
