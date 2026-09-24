import { hasCompleteSwapContext, parseSwapBlocks, swapBlockLabel, swapBlocksHours, type SwapGroupContext } from "@/lib/staffing/shift-swap-groups";
import { enumLabel } from "@/lib/display/enum-label";

export function SwapWorkContext({ row }: { row: SwapGroupContext }) {
  const requesting = parseSwapBlocks(row.requesting_group_snapshot);
  const covering = parseSwapBlocks(row.covering_group_snapshot);
  if (row.swap_scope !== "group" && !requesting?.length && !covering?.length) return null;
  if (row.swap_scope === "group" && !hasCompleteSwapContext(row)) return <p role="alert" className="text-sm text-warning">Complete group details are unavailable. Reload before confirming or approving.</p>;
  return <div className="space-y-3 text-sm">
    {row.swap_scope === "group" && <p className="font-medium">Whole shift group: confirmation includes every block below.</p>}
    {([["Requested work", requesting], ["Work offered in exchange", covering]] as const).map(([title, blocks]) => blocks?.length ? <section key={title} aria-label={title} className="space-y-1">
      <p className="font-medium">{title} · {swapBlocksHours(blocks).toFixed(1)} scheduled hours</p>
      <ul className="space-y-1">{blocks.map((block) => <li key={block.assignment_id} className="border-l-4 pl-2" style={{ borderColor: block.color || undefined }}>
        {swapBlockLabel(block)}{block.staff_role ? <span className="ml-1 text-muted-foreground">· {enumLabel(block.staff_role)}</span> : null}{block.rounding_coverage ? <span className="ml-1">· Includes rounding coverage</span> : null}
      </li>)}</ul>
    </section> : null)}
  </div>;
}
