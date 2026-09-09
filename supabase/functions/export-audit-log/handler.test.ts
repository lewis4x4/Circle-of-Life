import { handleAuditExport, type AuditExportClient } from "./handler.ts";

const JOB = "00000000-0000-0000-0000-000000000337";
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function request(body: unknown = { job_id: JOB }, authorization = "Bearer synthetic-token") {
  return new Request("https://haven.invalid/functions/v1/export-audit-log", {
    method: "POST", headers: { authorization, "Content-Type": "application/json", Origin: "https://haven.invalid" },
    body: JSON.stringify(body),
  });
}
async function snapshot(csv = 'id,old_data,new_data\r\n"1","before","after"\r\n') {
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { job_id: JOB, csv_content: csv, sha256_checksum: checksum, row_count: 1 };
}
function client(results: Array<{ data: unknown; error: { code?: string } | null }>) {
  const calls: string[] = [];
  const rpcClient: AuditExportClient = {
    rpc: (name, args) => {
      assert(args.p_job_id === JOB, "RPC must receive only the verified job identity");
      calls.push(name);
      const result = results.shift();
      if (!result) throw new Error("Unexpected RPC");
      return Promise.resolve(result);
    },
  };
  return { calls, rpcClient };
}

Deno.test("audit export rejects missing bearer and invalid job before constructing client", async () => {
  let constructed = 0;
  const factory = () => { constructed++; throw new Error("Must not construct client"); };
  const missing = await handleAuditExport(request({}, ""), factory);
  assert(missing.status === 401, "Missing bearer must be 401");
  const malformed = await handleAuditExport(request({ job_id: "../other-job.csv" }), factory);
  assert(malformed.status === 400, "Malformed job must be 400");
  assert(constructed === 0, "Invalid requests must not reach database");
});

Deno.test("audit export handles preflight and rejects non POST", async () => {
  const factory = () => { throw new Error("Must not construct client"); };
  const preflight = await handleAuditExport(new Request("https://haven.invalid", { method: "OPTIONS", headers: { Origin: "https://haven.invalid" } }), factory);
  assert(preflight.status === 200 && preflight.headers.get("Access-Control-Allow-Origin") === "https://haven.invalid", "Preflight must permit configured origin behavior");
  assert((await handleAuditExport(new Request("https://haven.invalid"), factory)).status === 405, "GET must be rejected");
});

Deno.test("audit export rejects malformed JSON", async () => {
  const result = await handleAuditExport(new Request("https://haven.invalid", { method: "POST", headers: { authorization: "Bearer token" }, body: "{" }), () => { throw new Error("Must not run"); });
  assert(result.status === 400, "Malformed JSON must fail before RPC");
});

Deno.test("audit export returns byte-identical durable CSV with verified checksum and no-store", async () => {
  const saved = await snapshot();
  const mock = client([{ data: { status: "completed" }, error: null }, { data: saved, error: null }]);
  const response = await handleAuditExport(request(), (authorization) => {
    assert(authorization === "Bearer synthetic-token", "JWT must reach user-scoped client");
    return mock.rpcClient;
  });
  assert(response.status === 200 && await response.text() === saved.csv_content, "Must return saved bytes");
  assert(mock.calls.join(",") === "materialize_audit_export,retrieve_audit_export", "Must reauthorize retrieval separately");
  assert(response.headers.get("X-Checksum-SHA256") === saved.sha256_checksum, "Checksum must match bytes");
  assert(response.headers.get("Cache-Control") === "no-store", "Sensitive export must not be cached");
  assert(response.headers.get("Access-Control-Expose-Headers")?.includes("X-Checksum-SHA256"), "Browser must receive checksum");
});

Deno.test("audit export preserves complete large snapshot and retries return same evidence", async () => {
  const rows = Array.from({ length: 2505 }, (_, i) => `${i},before-${i},after-${i}\r\n`).join("");
  const saved = { ...await snapshot(`id,old_data,new_data\r\n${rows}`), row_count: 2505 };
  const mock = client(Array.from({ length: 2 }, () => [{ data: { status: "completed" }, error: null }, { data: saved, error: null }]).flat());
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handleAuditExport(request(), () => mock.rpcClient);
    assert(response.status === 200 && await response.text() === saved.csv_content, "Export may not truncate or regenerate rows");
  }
});

Deno.test("audit export unauthorized materialization never retrieves data", async () => {
  const mock = client([{ data: null, error: { code: "42501" } }]);
  const response = await handleAuditExport(request(), () => mock.rpcClient);
  assert(response.status === 403 && mock.calls.length === 1, "Denied materialization must stop");
});

Deno.test("audit export revocation between materialization and retrieval returns no bytes", async () => {
  const mock = client([{ data: { status: "completed" }, error: null }, { data: null, error: { code: "42501" } }]);
  const response = await handleAuditExport(request(), () => mock.rpcClient);
  assert(response.status === 403 && !(await response.text()).includes("before"), "Revoked reader must not receive CSV");
});

Deno.test("audit export missing legacy snapshot returns actionable conflict", async () => {
  const mock = client([{ data: null, error: { code: "22023" } }]);
  assert((await handleAuditExport(request(), () => mock.rpcClient)).status === 409, "Unavailable snapshot must not appear completed");
});

Deno.test("audit export rejects wrong job identity and malformed snapshot", async () => {
  for (const invalid of [{ ...await snapshot(), job_id: "another-job" }, { ...await snapshot(), row_count: -1 }, null]) {
    const mock = client([{ data: {}, error: null }, { data: invalid, error: null }]);
    assert((await handleAuditExport(request(), () => mock.rpcClient)).status === 500, "Malformed snapshot must fail closed");
  }
});

Deno.test("audit export checksum mismatch returns no source bytes", async () => {
  const mock = client([{ data: {}, error: null }, { data: { ...await snapshot(), sha256_checksum: "a".repeat(64) }, error: null }]);
  const response = await handleAuditExport(request(), () => mock.rpcClient);
  assert(response.status === 500 && !(await response.text()).includes("before"), "Corrupt snapshot must fail closed");
});

Deno.test("audit export transport failures do not expose provider errors or source values", async () => {
  const response = await handleAuditExport(request(), () => ({ rpc: () => { throw new Error("sensitive row or credential text"); } }));
  const body = await response.text();
  assert(response.status === 500 && !body.includes("sensitive"), "Unexpected errors must be sanitized");
});
