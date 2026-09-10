/**
 * Processes an audit_log_export_jobs row: loads audit_log rows for the job scope,
 * builds CSV and a checksum through the current authenticated session.
 *
 * POST { "job_id": "<uuid>" }
 * Authorization: Bearer <user JWT>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

Deno.serve(async (req) => {
  const t = withTiming("export-audit-log");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "missing bearer" });
    return jsonResponse({ error: "Missing Authorization bearer token" }, 401);
  }

  let body: { job_id?: string };
  try {
    body = (await req.json()) as { job_id?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const jobId = body?.job_id;
  if (!jobId || typeof jobId !== "string") {
    return jsonResponse({ error: "job_id required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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

  try {
    // Read a stable cutoff in complete pages. Every page uses current RLS, including
    // the linked task/subject predicate; a failed page can never become an empty export.
    const PAGE_SIZE = 500;
    const cutoff = new Date().toISOString();
    const list: Array<Record<string, unknown>> = [];
    let lastId: string | null = null;
    let expectedCount: number | null = null;
    const scopedAuditRead = (head = false) => {
      let query = userClient.from("audit_log")
        .select("id, table_name, record_id, action, user_id, organization_id, facility_id, created_at", { count: "exact", head })
        .eq("organization_id", job.organization_id)
        .lte("created_at", cutoff);
      if (job.facility_id) {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(job.facility_id)) throw new Error("Invalid facility_id in job");
        query = query.eq("facility_id", job.facility_id);
      }
      if (job.date_from) query = query.gte("created_at", `${job.date_from}T00:00:00.000Z`);
      if (job.date_to) query = query.lte("created_at", `${job.date_to}T23:59:59.999Z`);
      return query;
    };
    while (true) {
      let q = scopedAuditRead().order("id", { ascending: true }).limit(PAGE_SIZE);
      if (lastId) q = q.gt("id", lastId);
      const { data: rows, error: rowsErr, count } = await q;
      if (rowsErr || !Array.isArray(rows) || typeof count !== "number") throw new Error("Audit read unavailable");
      if (expectedCount === null) expectedCount = count;
      if (count !== expectedCount - list.length) throw new Error("Export scope changed during retrieval");
      list.push(...rows);
      if (list.length === expectedCount) break;
      if (rows.length === 0) throw new Error("Export retrieval incomplete");
      lastId = rows[rows.length - 1].id;
    }

    // A transfer or grant change between pages must not expose already-read records.
    const assertCurrentScope = async (checkJob = true) => {
      const { data: identity, error: identityError } = await userClient.auth.getUser();
      if (identityError || identity.user?.id !== user.id) throw new Error("Export session changed");
      const { count: currentCount, error: countError } = await scopedAuditRead(true);
      if (countError || currentCount !== list.length) throw new Error("Export scope changed");
      for (let offset = 0; offset < list.length; offset += PAGE_SIZE) {
        const ids = list.slice(offset, offset + PAGE_SIZE).map((row) => row.id);
        const { count, error } = await userClient.from("audit_log")
          .select("id", { count: "exact", head: true })
          .in("id", ids)
          .eq("organization_id", job.organization_id);
        if (error || count !== ids.length) throw new Error("Export authority changed");
      }
      // Empty exports also require a fresh guarded database request.
      const { data: profile, error: profileError } = await userClient.from("user_profiles")
        .select("id").eq("id", user.id).eq("is_active", true).is("deleted_at", null).maybeSingle();
      if (profileError || !profile) throw new Error("Export actor authority changed");
      if (job.facility_id) {
        const { data: access, error: accessError } = await userClient.rpc("haven_operation_facility_access", { p_facility_id: job.facility_id });
        if (accessError || access !== true) throw new Error("Export facility authority changed");
      }
      if (checkJob) {
        const { data: currentJob, error: currentJobError } = await userClient.from("audit_log_export_jobs")
          .select("id").eq("id", jobId).eq("requested_by", user.id).is("deleted_at", null).maybeSingle();
        if (currentJobError || !currentJob) throw new Error("Export job authority changed");
      }
    };
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

    // Current authority is asserted after the bytes are built and before the job
    // is completed; the completion command's own locked recheck is the last gate,
    // so a denial can never leave a completed job with no bytes delivered.
    await assertCurrentScope();
    const { data: completed, error: completionError } = await userClient.rpc(
      "haven_complete_audit_export_job", { p_job_id: jobId },
    );
    if (completionError || completed !== true) throw new Error("Export completion could not be confirmed");

    t.log({ event: "complete", outcome: "success", job_id: jobId, row_count: list.length });

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
    t.log({ event: "error", outcome: "error", job_id: jobId, error_message: e instanceof Error ? e.message : String(e) });
    return jsonResponse({ error: "Export failed" }, 500);
  }
});
