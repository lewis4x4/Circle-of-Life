"use client";

import * as React from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Build a tel: href; US 10- and 11-digit numbers normalized to +1. */
export function toTelHref(raw: string): string | null {
  const d = digitsOnly(raw);
  if (d.length < 7) return null;
  if (d.length === 10) return `tel:+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `tel:+${d}`;
  if (d.startsWith("+")) return `tel:${raw.trim()}`;
  return `tel:+${d}`;
}

export function formatPhoneNational(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return raw.trim();
}

export function PhoneLink({
  phone,
  className,
  iconClassName,
  children,
  iconOnly,
}: {
  phone: string;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
  /** Icon-only dial chip (e.g. next to editable fields on Building & Safety). */
  iconOnly?: boolean;
}) {
  const href = toTelHref(phone);
  if (!href) {
    return <span className={className}>{children ?? phone}</span>;
  }

  if (iconOnly) {
    return (
      <a
        href={href}
        className={cn(
          "inline-flex shrink-0 rounded-md p-1 text-muted-foreground opacity-80 transition-colors hover:bg-muted hover:opacity-100",
          className,
        )}
        aria-label={`Call ${phone}`}
        title={`Call ${phone}`}
      >
        <Phone className={cn("h-4 w-4", iconClassName)} aria-hidden />
      </a>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[4px] px-1 py-0.5 text-sm font-medium text-foreground transition-colors hover:cursor-pointer hover:bg-muted/80",
        className,
      )}
    >
      <Phone className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", iconClassName)} aria-hidden />
      <span className="min-w-0 tabular-nums">{children ?? formatPhoneNational(phone)}</span>
    </a>
  );
}
