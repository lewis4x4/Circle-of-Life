import { getCorsHeaders, jsonResponse as sharedJsonResponse } from "../_shared/cors.ts";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type AuditExportClient = {
  rpc: (name: string, args: { p_job_id: string }) => PromiseLike<RpcResult>;
};

type Snapshot = {
  job_id: string;
  csv_content: string;
  sha256_checksum: string;
  row_count: number;
};

function isSnapshot(value: unknown, jobId: string): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.job_id === jobId && typeof row.csv_content === "string" &&
    typeof row.sha256_checksum === "string" && /^[a-f0-9]{64}$/.test(row.sha256_checksum) &&
    typeof row.row_count === "number" && Number.isSafeInteger(row.row_count) && row.row_count >= 0;
}

function rpcFailure(error: { code?: string }, origin: string | null): Response {
  const jsonResponse = (body: Record<string, unknown>, status: number) => sharedJsonResponse(body, status, origin);
  if (error.code === "42501" || error.code === "PGRST301") {
    return jsonResponse({ error: "Audit export not authorized" }, 403);
  }
  if (error.code === "22023") return jsonResponse({ error: "Export snapshot unavailable" }, 409);
  return jsonResponse({ error: "Export failed" }, 500);
}

/** User-scoped RPCs enforce the live profile, session and facility boundary.
 * No service client or client-supplied completion result enters this path.
 */
export async function handleAuditExport(
  req: Request,
  createUserClient: (authorization: string) => AuditExportClient,
): Promise<Response> {
  const origin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonResponse = (body: Record<string, unknown>, status: number) => sharedJsonResponse(body, status, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization || !/^Bearer \S+$/.test(authorization)) {
    return jsonResponse({ error: "Missing Authorization bearer token" }, 401);
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const jobId = body && typeof body === "object" ? (body as Record<string, unknown>).job_id : null;
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return jsonResponse({ error: "Valid job_id required" }, 400);
  }
  try {
    const client = createUserClient(authorization);
    const materialized = await client.rpc("materialize_audit_export", { p_job_id: jobId });
    if (materialized.error) return rpcFailure(materialized.error, origin);
    // A separate call rechecks authority after materialization, including a
    // revocation between the two requests. Completed requests retrieve the
    // same bytes; retries do not query the live audit table again.
    const retrieved = await client.rpc("retrieve_audit_export", { p_job_id: jobId });
    if (retrieved.error) return rpcFailure(retrieved.error, origin);
    if (!isSnapshot(retrieved.data, jobId)) return jsonResponse({ error: "Invalid export snapshot" }, 500);
    const snapshot = retrieved.data;
    const bytes = new TextEncoder().encode(snapshot.csv_content);
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (checksum !== snapshot.sha256_checksum) return jsonResponse({ error: "Export integrity check failed" }, 500);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${jobId}.csv"`,
        "X-Checksum-SHA256": checksum,
        "Access-Control-Expose-Headers": "Content-Disposition, X-Checksum-SHA256",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonResponse({ error: "Export failed" }, 500);
  }
}
