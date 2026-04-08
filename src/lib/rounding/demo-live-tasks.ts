/**
 * Live Rounding board embeds demo rows when no facility is selected, Supabase
 * is not configured, the query fails, or it returns zero tasks. Those rows use
 * synthetic ids (d1, d2, …) that are not real `resident_observation_tasks` rows.
 */
export function isRoundingLiveDemoTaskId(taskId: string): boolean {
  return /^d\d+$/.test(taskId);
}
