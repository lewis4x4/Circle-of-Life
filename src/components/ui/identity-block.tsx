"use client";

import { useMemo } from "react";
import { Building2, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type IdentityBlockSize = "sm" | "md" | "lg" | "xl";

export type IdentityBlockProps = {
  fullName: string | null;
  email: string | null;
  roleLabel: string;
  orgName: string | null;
  avatarUrl: string | null;
  userId: string | null;
  size?: IdentityBlockSize;
  className?: string;
};

const AVATAR_PALETTE = [
  "#8aa4a8",
  "#a79a85",
  "#9a9f86",
  "#9b8fa7",
  "#8f9db0",
  "#ad948a",
  "#86a194",
  "#a1889a",
  "#8d9b88",
  "#9b9686",
  "#889ba8",
  "#a08f88",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toLightSibling(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const target = 235; // ~92% lightness in RGB space.
  const mix = (channel: number) => Math.round(channel + (target - channel) * 0.72);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

export function gradientFromUserId(userId: string): string {
  const base = AVATAR_PALETTE[hashString(userId) % AVATAR_PALETTE.length];
  return `linear-gradient(135deg, ${base}, ${toLightSibling(base)})`;
}

export function getIdentityInitials(fullName: string | null, email: string | null): string {
  const trimmedName = fullName?.trim();
  if (trimmedName) {
    const initials = trimmedName
      .split(/\s+/)
      .map((word) => word[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    if (initials) return initials;
  }

  const localPart = email?.split("@")[0]?.trim() ?? "";
  const emailInitials = localPart
    .split(/[._+\-\s]+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return emailInitials || localPart.slice(0, 2).toUpperCase() || "?";
}

const avatarSizeClasses: Record<IdentityBlockSize, string> = {
  sm: "size-7",
  md: "size-9",
  lg: "size-10",
  xl: "size-32",
};

const nameClasses: Record<IdentityBlockSize, string> = {
  sm: "text-[12px]",
  md: "text-[13px]",
  lg: "text-[13px]",
  xl: "text-lg",
};

const emailClasses: Record<IdentityBlockSize, string> = {
  sm: "text-[11px]",
  md: "text-[12px]",
  lg: "text-[12px]",
  xl: "text-sm",
};

export function IdentityAvatar({
  fullName,
  email,
  avatarUrl,
  userId,
  size = "md",
  className,
}: Pick<IdentityBlockProps, "fullName" | "email" | "avatarUrl" | "userId" | "size"> & {
  className?: string;
}) {
  const initials = useMemo(() => getIdentityInitials(fullName, email), [fullName, email]);
  // Memo the gradient style so identical userId renders don't churn the inline-style object
  // (P1 #1 — avoid downstream re-renders on parents like UserMenu/IdentityBlock).
  const fallbackStyle = useMemo(
    () => (userId ? { background: gradientFromUserId(userId) } : undefined),
    [userId],
  );

  return (
    <Avatar
      size={size === "sm" ? "sm" : size === "lg" ? "lg" : "default"}
      className={cn(avatarSizeClasses[size], className)}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        // P0-1: gradient terminates at L≈92%; hard-set near-black text so dark mode + light gradient end keep ≥4.5:1.
        className="font-semibold text-zinc-900 group-data-[size=sm]/avatar:text-[10px]"
        style={fallbackStyle}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export function IdentityBlock({
  fullName,
  email,
  roleLabel,
  orgName,
  avatarUrl,
  userId,
  size = "md",
  className,
}: IdentityBlockProps) {
  const displayName = fullName?.trim() || email || "Signed in";
  const organization = orgName?.trim() || "Organization";
  const spacious = size === "xl";

  return (
    <div className={cn("flex min-w-0 items-center gap-3", spacious && "items-start gap-4", className)}>
      <IdentityAvatar
        fullName={fullName}
        email={email}
        avatarUrl={avatarUrl}
        userId={userId}
        size={size}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <p className={cn("truncate font-semibold text-foreground", nameClasses[size])}>{displayName}</p>
        {email ? <p className={cn("mt-0.5 truncate text-muted-foreground", emailClasses[size])}>{email}</p> : null}
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{roleLabel}</span>
          <span aria-hidden>·</span>
          <Building2 className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{organization}</span>
        </p>
      </div>
    </div>
  );
}
