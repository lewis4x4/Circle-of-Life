/**
 * Processes an audit_log_export_jobs row: loads audit_log rows for the job scope,
 * builds CSV, SHA-256 checksum, updates job (owner/org_admin completion path via service role after JWT auth).
 *
 * POST { "job_id": "<uuid>" }
 * Authorization: Bearer <user JWT>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing Authorization bearer token" }, 401);
  }

  let body: { job_id?: string };
  try {
    body = (await req.json()) as { job_id?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const jobId = body.job_id;
  if (!jobId || typeof jobId !== "string") {
    return jsonResponse({ error: "job_id required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }

  const { data: job, error: jobErr } = await userClient
    .from("audit_log_export_jobs")
    .select(
      "id, organization_id, requested_by, facility_id, date_from, date_to, format, status",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (jobErr || !job) {
    return jsonResponse({ error: "Export job not found" }, 404);
  }
  if (job.requested_by !== user.id) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  if (job.status !== "pending" && job.status !== "failed") {
    return jsonResponse({ error: `Job not actionable (status=${job.status})` }, 409);
  }
  if (job.format !== "csv") {
    return jsonResponse({ error: "Only csv format is supported in this function" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const nowIso = new Date().toISOString();
  await admin
    .from("audit_log_export_jobs")
    .update({
      status: "processing",
      error_message: null,
    })
    .eq("id", jobId);

  try {
    let q = admin
      .from("audit_log")
      .select(
        "id, table_name, record_id, action, old_data, new_data, changed_fields, user_id, ip_address, user_agent, organization_id, facility_id, created_at",
      )
      .eq("organization_id", job.organization_id)
      .order("created_at", { ascending: true });

    if (job.facility_id) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(job.facility_id)) throw new Error("Invalid facility_id in job");
      q = q.or(`facility_id.eq.${job.facility_id},facility_id.is.null`);
    }
    if (job.date_from) {
      q = q.gte("created_at", `${job.date_from}T00:00:00.000Z`);
    }
    if (job.date_to) {
      q = q.lte("created_at", `${job.date_to}T23:59:59.999Z`);
    }

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw new Error(rowsErr.message);

    const list = rows ?? [];
    const header = [
      "id",
      "table_name",
      "record_id",
      "action",
      "user_id",
      "organization_id",
      "facility_id",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of list) {
      lines.push(
        [
          escapeCsvCell(r.id),
          escapeCsvCell(r.table_name),
          escapeCsvCell(r.record_id),
          escapeCsvCell(r.action),
          escapeCsvCell(r.user_id),
          escapeCsvCell(r.organization_id),
          escapeCsvCell(r.facility_id),
          escapeCsvCell(r.created_at),
        ].join(","),
      );
    }
    const csv = lines.join("\r\n") + "\r\n";
    const bytes = new TextEncoder().encode(csv);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { error: upErr } = await admin
      .from("audit_log_export_jobs")
      .update({
        status: "completed",
        sha256_checksum: sha256,
        row_count: list.length,
        completed_at: nowIso,
        storage_path: null,
        error_message: null,
      })
      .eq("id", jobId);

    if (upErr) throw new Error(upErr.message);

    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${jobId}.csv"`,
        "X-Checksum-SHA256": sha256,
      },
    });
  } catch (e) {
    console.error("[export-audit-log]", e);
    const internalMsg = e instanceof Error ? e.message : String(e);
    await admin
      .from("audit_log_export_jobs")
      .update({
        status: "failed",
        error_message: internalMsg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return jsonResponse({ error: "Export failed" }, 500);
  }
});
