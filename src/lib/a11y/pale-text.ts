/**
 * Hard-coded pale grey text utilities (`text-slate-400`, `text-zinc-500`, …)
 * without a `dark:` prefix. On the light theme's cream canvas and cards they
 * fall under WCAG AA (axe color-contrast, COL-658) and they bypass the
 * design-system tokens, so a token fix never reaches them. Use
 * `text-muted-foreground` (or `text-text-muted` in v2) instead.
 */
export const PALE_TEXT_PATTERN = /(?<![\w:-])text-(?:slate|zinc|stone|gray|neutral)-(?:300|400|500)(?![\w-])/g;

export function countPaleText(source: string): number {
  return source.match(PALE_TEXT_PATTERN)?.length ?? 0;
}
