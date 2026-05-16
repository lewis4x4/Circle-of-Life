"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  type MoonshotColor,
  getMoonshotColor,
  createTextGlow,
} from "@/lib/moonshot-theme";

// ── SysLabel: small mono uppercase label ──

export function SysLabel({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: MoonshotColor;
  className?: string;
}) {
  const style = color
    ? { color: getMoonshotColor(color), textShadow: createTextGlow(color) }
    : undefined;

  return (
    <span
      className={cn(
        "text-[10px] font-mono uppercase tracking-[0.15em] text-slate-400",
        color && "text-current",
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
}

// ── TitleH1: large page title ──

export function TitleH1({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "text-3xl sm:text-4xl font-bold tracking-tight text-white",
        className
      )}
    >
      {children}
    </h1>
  );
}

// ── Subtitle: muted subtitle text ──

export function Subtitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-slate-400 mt-1", className)}>{children}</p>
  );
}

// ── MonoLabel: small mono label used inside cards ──

export function MonoLabel({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: MoonshotColor;
  className?: string;
}) {
  const style = color
    ? { color: getMoonshotColor(color) }
    : undefined;

  return (
    <span
      className={cn(
        "text-[11px] font-mono uppercase tracking-wider text-slate-400",
        color && "text-current",
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
}

// ── MetricValue: large number display ──

export function MetricValue({
  children,
  color,
  size = "3xl",
  className,
}: {
  children: React.ReactNode;
  color?: MoonshotColor;
  size?: "xl" | "2xl" | "3xl" | "4xl";
  className?: string;
}) {
  const sizeClass = {
    xl: "text-xl",
    "2xl": "text-2xl",
    "3xl": "text-3xl",
    "4xl": "text-4xl",
  }[size];

  const style = color
    ? { color: getMoonshotColor(color), textShadow: createTextGlow(color) }
    : undefined;

  return (
    <span
      className={cn(
        "font-bold tabular-nums tracking-tight text-white",
        sizeClass,
        color && "text-current",
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
}
