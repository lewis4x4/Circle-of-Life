/**
 * KPI helpers for Facility Building & Safety metrics strip (fire, generator, CEMP scaffold).
 */

function parseYmd(s: string | null | undefined): Date | null {
  if (s == null || typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return null;
  const d = new Date(`${s.trim()}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysSinceYmd(ymd: string | null | undefined, now = new Date()): number | null {
  const d = parseYmd(ymd);
  if (!d) return null;
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export function daysUntilYmd(ymd: string | null | undefined, now = new Date()): number | null {
  const d = parseYmd(ymd);
  if (!d) return null;
  const diff = d.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export function fireInspectionStalenessAccent(daysSince: number | null): string {
  if (daysSince == null) return "text-muted-foreground";
  if (daysSince > 365) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

export function fireNextDueAccent(daysUntil: number | null): string {
  if (daysUntil == null) return "text-muted-foreground";
  if (daysUntil <= 14) return "text-red-600 dark:text-red-400";
  if (daysUntil <= 60) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

export function generatorTestAccent(daysSince: number | null, hasGenerator: boolean): string {
  if (!hasGenerator) return "text-muted-foreground";
  if (daysSince == null) return "text-amber-600 dark:text-amber-400";
  if (daysSince > 365) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}
