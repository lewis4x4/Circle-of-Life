"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export type SortableTableHeaderProps = {
  column: string;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
  defaultDirection?: SortDirection;
};

export function SortableTableHeader({
  column,
  children,
  className,
  align = "left",
  defaultDirection = "asc",
}: SortableTableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort") ?? "";
  const currentDirection = (searchParams.get("dir") as SortDirection | null) ?? "desc";
  const active = currentSort === column;
  const ariaSort = active ? (currentDirection === "asc" ? "ascending" : "descending") : "none";

  function updateSort() {
    const params = new URLSearchParams(searchParams.toString());
    const nextDirection: SortDirection = active ? (currentDirection === "asc" ? "desc" : "asc") : defaultDirection;
    params.set("sort", column);
    params.set("dir", nextDirection);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const Icon = active ? (currentDirection === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <th scope="col" aria-sort={ariaSort} className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        onClick={updateSort}
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-semibold normal-case tracking-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "ml-auto",
        )}
      >
        <span>{children}</span>
        <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}
