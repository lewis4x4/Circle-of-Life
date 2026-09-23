import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An identifier (incident number, MRN, invoice number, code) that reads best in
 * a fixed-width face. The only sanctioned home for `font-mono` outside real code
 * blocks (COL-656); labels, numbers and body copy stay in the UI face.
 */
export function IdText({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("bg-transparent p-0 font-mono text-[0.95em]", className)}>{children}</code>;
}
