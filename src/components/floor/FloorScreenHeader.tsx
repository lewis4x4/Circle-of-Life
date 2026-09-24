"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLOOR_BACK_BUTTON } from "./floor-styles";

/** Back is a link to a screen or a step back inside one. */
export type FloorBack = { href: string; label: string } | { onClick: () => void; label: string };

export function FloorBackButton({ back }: { back: FloorBack }) {
  if ("href" in back) {
    return (
      <Link href={back.href} aria-label={back.label} className={FLOOR_BACK_BUTTON}>
        <ArrowLeft className="size-4.5" aria-hidden />
      </Link>
    );
  }
  return (
    <button type="button" onClick={back.onClick} aria-label={back.label} className={FLOOR_BACK_BUTTON}>
      <ArrowLeft className="size-4.5" aria-hidden />
    </button>
  );
}

/**
 * A screen's title row (DESIGN.md 05, 06, 07): back, title with its sub line,
 * and one thing on the right (a pill, the question counter).
 */
export function FloorScreenHeader({
  back,
  title,
  subtitle,
  right,
  bordered = true,
  titleSize = "md",
}: {
  back: FloorBack;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  bordered?: boolean;
  titleSize?: "md" | "lg";
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-between gap-4 px-6 py-4", bordered && "border-b border-border")}>
      <div className="flex min-w-0 items-center gap-4">
        <FloorBackButton back={back} />
        <div className="flex min-w-0 flex-col gap-0.75">
          <h1 className={cn("font-semibold text-foreground", titleSize === "lg" ? "text-[26px]" : "text-2xl")}>{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
