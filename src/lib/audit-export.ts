/**
 * Client-side invocation of the `export-audit-log` Edge Function (CSV).
 * Requires an existing `audit_log_export_jobs` row in `pending` or `failed`.
 */
export async function invokeExportAuditLog(params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  jobId: string;
}): Promise<
  | { ok: true; blob: Blob; filename: string; checksumSha256: string | null }
  | { ok: false; status: number; message: string }
> {
  const url = `${params.supabaseUrl.replace(/\/$/, "")}/functions/v1/export-audit-log`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: params.jobId }),
  });

  const checksumSha256 = res.headers.get("X-Checksum-SHA256");

  if (res.ok) {
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    const match = cd?.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `audit-export-${params.jobId}.csv`;
    return { ok: true, blob, filename, checksumSha256 };
  }

  let message = `Request failed (${res.status})`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) message = j.error;
  } catch {
    try {
      const t = await res.text();
      if (t) message = t.slice(0, 500);
    } catch {
      /* ignore */
    }
  }
  return { ok: false, status: res.status, message };
}
