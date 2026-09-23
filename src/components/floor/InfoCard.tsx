"use client";

import type { InfoItem } from "@/lib/floor/resident-detail";

import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_SECTION_LABEL } from "./floor-styles";

/**
 * One of the resident screen's three cards (DESIGN.md 04): a muted sentence-case
 * label, then lines of 15/500 with a 13 px note under each.
 */
export function InfoCard({
  title,
  items,
  state,
  emptyText,
}: {
  title: string;
  items: readonly InfoItem[];
  state: "loading" | "error" | "ready";
  emptyText: string;
}) {
  const headingId = `floor-card-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-1 basis-0 flex-col rounded-[12px] border border-border bg-card px-4.5 py-4">
      <h2 id={headingId} className={`${FLOOR_SECTION_LABEL} mb-1`}>
        {title}
      </h2>
      {state === "loading" ? (
        <FloorStatePanel state="loading" title="Loading" className="py-6" />
      ) : state === "error" ? (
        <FloorStatePanel state="error" title="This could not load." className="py-6" />
      ) : items.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-0.75 border-b border-border py-3">
              <span className="break-words text-[15px] font-medium tabular-nums text-foreground">{item.title}</span>
              {item.detail ? <span className="text-[13px] text-muted-foreground">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
