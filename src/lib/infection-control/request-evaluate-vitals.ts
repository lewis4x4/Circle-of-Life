/**
 * Single client entrypoint after a daily_logs row with vitals is saved.
 * Calls the server-owned evaluation path (POST /api/infection-control/evaluate-vitals).
 */
export async function requestEvaluateVitals(dailyLogId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/infection-control/evaluate-vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLogId }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
