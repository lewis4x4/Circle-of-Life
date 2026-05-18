"use client";

import Link from "next/link";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TemplateCardProps = {
  slug: string;
  templateId: string | null;
  name: string;
  audience: string;
  description: string;
  category: string;
  defaultRange: string;
  isNew?: boolean;
  isPinned?: boolean;
  pinDisabled?: boolean;
  onTogglePin: () => void;
  pinBusy?: boolean;
  /** Relative phrase only (e.g. "3 days ago"); shown as "Last run … by you". */
  lastRunRelative?: string | null;
  scheduledSummary?: string | null;
};

function BottomStrip(props: {
  category: string;
  defaultRange: string;
  lastRunRelative?: string | null;
  scheduledSummary?: string | null;
}) {
  const parts: string[] = [props.category, props.defaultRange];
  if (props.lastRunRelative) {
    parts.push(`Last run ${props.lastRunRelative} by you`);
  }
  if (props.scheduledSummary) {
    parts.push(props.scheduledSummary);
  }
  return <p className="text-[12px] leading-snug text-muted-foreground/75">{parts.join(" · ")}</p>;
}

export function TemplateCard(props: TemplateCardProps) {
  return (
    <div
      className={cn(
        "group/card relative flex min-h-[260px] max-h-[320px] flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-[box-shadow,transform] duration-100 hover:shadow-md md:p-5",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={props.pinDisabled || props.pinBusy}
        aria-label={
          props.pinDisabled
            ? "Pin unavailable until template is synced"
            : props.isPinned
              ? "Unpin template"
              : "Pin template"
        }
        aria-pressed={props.isPinned}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (props.pinDisabled) return;
          props.onTogglePin();
        }}
        className={cn(
          "absolute right-3 top-3 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground",
          props.isPinned && "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
          props.pinDisabled && "opacity-40 hover:text-muted-foreground",
        )}
      >
        <Star className={cn("size-4", props.isPinned && "fill-current")} aria-hidden />
      </Button>

      <div className="flex min-h-0 flex-1 flex-col pr-8">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">{props.name}</h3>
          {props.isNew ? (
            <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[11px] font-medium normal-case">
              New
            </Badge>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-muted-foreground">For {props.audience}</p>

        <p className="mt-2 line-clamp-3 flex-1 text-sm font-normal leading-relaxed text-muted-foreground">
          {props.description}
        </p>

        <div className="mt-4 min-h-0">
          <BottomStrip
            category={props.category}
            defaultRange={props.defaultRange}
            lastRunRelative={props.lastRunRelative}
            scheduledSummary={props.scheduledSummary}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
        <Link
          href={`/admin/reports/templates/${props.slug}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full rounded-md font-normal")}
        >
          Preview
        </Link>
        <Link
          href={`/admin/reports/run/template/${props.slug}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-full rounded-md font-normal transition-colors",
            "group-hover/card:border-primary group-hover/card:bg-primary group-hover/card:text-primary-foreground group-hover/card:shadow-sm",
            "focus-visible:border-primary focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:shadow-sm",
          )}
        >
          Run now
        </Link>
      </div>
    </div>
  );
}
