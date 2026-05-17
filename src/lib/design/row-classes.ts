/**
 * @deprecated Use the `<TableRow>` / `<TableRowHeader>` component primitives
 * from `@/components/ui/table-row` instead. Class-string consumers are
 * kept compiling only for the back-compat migration window; the canonical
 * way to render a Quiet Operator Table / List / Queue row is the component
 * primitive (see `src/components/ui/table-row.tsx` doc block for the
 * binding rules).
 *
 * Migration:
 *   - <Link className={TABLE_ROW_CLASS}>...</Link>
 *     →
 *     <TableRow render={<Link href={...} />}>...</TableRow>
 *
 *   - <div className={TABLE_HEADER_CLASS}>...</div>
 *     →
 *     <TableRowHeader>...</TableRowHeader>
 */

export const TABLE_ROW_CLASS =
  "flex items-center gap-3 h-9 px-[13px] rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

export const TABLE_HEADER_CLASS =
  "flex items-center gap-3 h-8 px-[13px] border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
