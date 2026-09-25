import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposalResultProblems, type ProposalResult } from "../_shared/document-intake-contract.ts";
import {
  type CatalogRow,
  type Claim,
  handleProcessorRequest,
  type Policy,
  type ProcessorDeps,
  runProcessorTick,
} from "./handler.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY = "00000000-0000-0000-0000-000000000301";
const ITEM = "10000000-0000-4000-8000-000000000001";
const RUN = "11000000-0000-4000-8000-000000000001";
const FENCE = "12000000-0000-4000-8000-000000000001";
const JANE_A = "20000000-0000-4000-8000-000000000001";
const JANE_B = "20000000-0000-4000-8000-000000000002";
const JOHN = "20000000-0000-4000-8000-000000000003";
// Synthetic fixture built at runtime so secret scanners never see a literal.
const SECRET = "p".repeat(40);

const BYTES = new TextEncoder().encode("%PDF-1.7 fake document bytes");

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function catalogRow(overrides: Partial<CatalogRow> & { code: string }): CatalogRow {
  return {
    label: overrides.code,
    subject_kind: "resident",
    destination_kind: "resident_document",
    contains_phi: true,
    jev_enabled: true,
    reader_enabled: true,
    reader_hint: "",
    active: true,
    ...overrides,
  };
}

const CATALOG: CatalogRow[] = [
  catalogRow({ code: "form_1823", label: "AHCA Form 1823", reader_hint: "Completed and signed by a physician." }),
  catalogRow({ code: "vendor_coi", label: "Vendor certificate of insurance", subject_kind: "facility", destination_kind: "facility_document", contains_phi: false }),
  catalogRow({ code: "payment_evidence", label: "Check / deposit", subject_kind: "none", destination_kind: "none", jev_enabled: false, reader_enabled: false }),
  catalogRow({ code: "unknown", label: "Not sure yet", subject_kind: "none", destination_kind: "none" }),
];

function policy(routing: Policy["routing"] = { enabled: true, jev_enabled: true, jev_phi_enabled: true }): Policy {
  return { allow_phi: true, baa_recorded: true, default_provider: "anthropic", routing };
}

async function claim(overrides: { policy?: Policy | null; mime?: string; sha?: string; facility?: string | null } = {}): Promise<Claim> {
  return {
    run: { id: RUN, fence: FENCE, generation: 1, item_id: ITEM },
    item: {
      id: ITEM,
      facility_id: overrides.facility === undefined ? FACILITY : overrides.facility,
      channel: "upload",
      original_filename: "Scan_2026-09-20.pdf",
      declared_mime: overrides.mime ?? "application/pdf",
      declared_size_bytes: BYTES.length,
      verified_mime: overrides.mime ?? "application/pdf",
      verified_sha256: overrides.sha ?? await sha256Hex(BYTES),
      storage_path: `${ORG}/${FACILITY}/${ITEM}/original`,
      page_count: 2,
      sender_address: null,
      sender_authenticated: false,
    },
    catalog: CATALOG,
    policy: overrides.policy === undefined ? policy() : overrides.policy,
  };
}

function readerJson(overrides: Record<string, unknown> = {}) {
  return {
    catalog_code: "form_1823",
    suggested_title: "AHCA Form 1823 — Jane Doe — 2026-09-01",
    summary: "Physician's health assessment for Jane Doe.",
    summary_pages: [1],
    document_date: "2026-09-01",
    expiration_date: null,
    segments: [],
    subject_hints: { person_names: ["Jane Doe"], date_of_birth: null, employee_names: [], vendor_names: [], agency: null },
    page_count: 2,
    warnings: [],
    ...overrides,
  };
}

function anthropicOk(body: unknown) {
  return new Response(JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(body) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1200, output_tokens: 150 },
  }), { status: 200 });
}

const SUBJECTS_ONE_JANE = {
  residents: [
    { id: JANE_A, first_name: "Jane", last_name: "Doe", preferred_name: null, date_of_birth: "1940-01-01", status: "active" },
    { id: JOHN, first_name: "John", last_name: "Smith", preferred_name: null, date_of_birth: "1938-05-05", status: "active" },
  ],
  staff: [],
  medicaid_cases: [],
  facility: { id: FACILITY, name: "Homewood Lodge" },
};

type Harness = {
  deps: ProcessorDeps;
  events: string[];
  rpcArgs: (fn: string) => Record<string, unknown>[];
  published: () => ProposalResult[];
};

function harness(opts: {
  claim: Claim;
  anthropic?: () => Promise<Response> | Response;
  typesafe?: (body: unknown) => Promise<Response> | Response;
  subjects?: unknown;
  rpc?: Record<string, { data?: unknown; error?: { code: string; message: string } }>;
  env?: Record<string, string>;
}): Harness {
  const events: string[] = [];
  const args: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let claimed = false;
  const env: Record<string, string> = { ANTHROPIC_API_KEY: "sk-test", TYPESAFE_API_KEY: "ts-test", DOCUMENT_INTAKE_PROCESSOR_SECRET: SECRET, ...opts.env };
  const deps: ProcessorDeps = {
    db: {
      rpc(fn, a) {
        events.push(`rpc:${fn}`);
        args.push({ fn, args: a });
        const override = opts.rpc?.[fn];
        if (override) return Promise.resolve({ data: override.data ?? null, error: override.error ?? null });
        switch (fn) {
          case "document_intake_worker_claim":
            if (claimed) return Promise.resolve({ data: null, error: null });
            claimed = true;
            return Promise.resolve({ data: opts.claim, error: null });
          case "document_intake_worker_dispatch":
            return Promise.resolve({ data: crypto.randomUUID(), error: null });
          case "document_intake_worker_subjects":
            return Promise.resolve({ data: opts.subjects ?? SUBJECTS_ONE_JANE, error: null });
          case "document_intake_worker_complete":
            return Promise.resolve({ data: { proposal_id: crypto.randomUUID() }, error: null });
          default:
            return Promise.resolve({ data: null, error: null });
        }
      },
      download() {
        events.push("download");
        return Promise.resolve({ data: BYTES, error: null });
      },
    },
    env: (name) => env[name],
    fetch: async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://api.anthropic.com/")) {
        events.push("fetch:anthropic");
        if (!opts.anthropic) throw new Error("unexpected reader call");
        return await opts.anthropic();
      }
      if (url.startsWith("https://api.typesafe.ai/")) {
        events.push("fetch:typesafe");
        if (!opts.typesafe) throw new Error("unexpected Jev call");
        return await opts.typesafe(JSON.parse(String(init?.body)));
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    now: () => new Date("2026-09-25T15:00:00Z"),
    log: () => {},
    workerId: "test-worker",
  };
  return {
    deps,
    events,
    rpcArgs: (fn) => args.filter((a) => a.fn === fn).map((a) => a.args),
    published: () => args.filter((a) => a.fn === "document_intake_worker_complete").map((a) => a.args.p_result as ProposalResult),
  };
}

function assertValid(result: ProposalResult) {
  assertEquals(proposalResultProblems(result), []);
}

Deno.test("blocked by policy: no download, no reader, no Jev; honest blocked result", async () => {
  const h = harness({ claim: await claim({ policy: { ...policy(), allow_phi: false } }) });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.blocked, 1);
  assert(!h.events.some((e) => e.startsWith("fetch:") || e === "download"));
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.outcome, "blocked");
  assertEquals(result.stage_status.reader.state, "not_authorized");
  assertEquals(result.candidates, []);
  assertEquals(result.proposed_candidate, null);
  assertEquals(result.suggested_title, "Scan 2026-09-20");
});

Deno.test("blocked when routing is off, and when the reader key is missing", async () => {
  const off = harness({ claim: await claim({ policy: policy({ enabled: false }) }) });
  await runProcessorTick(off.deps);
  assertEquals(off.published()[0].outcome_code, "routing_disabled");
  const noKey = harness({ claim: await claim(), env: { ANTHROPIC_API_KEY: "" } });
  await runProcessorTick(noKey.deps);
  assertEquals(noKey.published()[0].stage_status.reader.state, "not_configured");
  assert(![...off.events, ...noKey.events].some((e) => e.startsWith("fetch:")));
});

Deno.test("HEIC is preview only: skipped, not sent", async () => {
  const h = harness({ claim: await claim({ mime: "image/heic" }) });
  await runProcessorTick(h.deps);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.outcome, "skipped");
  assertEquals(result.stage_status.reader, { state: "not_applicable", reason: "Preview only; read it yourself" });
  assert(!h.events.some((e) => e.startsWith("fetch:")));
});

Deno.test("source hash mismatch fails before anything is sent", async () => {
  const h = harness({ claim: await claim({ sha: "0".repeat(64) }), anthropic: () => anthropicOk(readerJson()) });
  await runProcessorTick(h.deps);
  assertEquals(h.rpcArgs("document_intake_worker_fail")[0].p_code, "source_mismatch");
  assertEquals(h.rpcArgs("document_intake_worker_fail")[0].p_uncertain, false);
  assert(!h.events.includes("fetch:anthropic"));
});

Deno.test("dispatch intent is recorded before the reader call; returned after it", async () => {
  const h = harness({
    claim: await claim({ policy: policy({ enabled: true, jev_enabled: false }) }),
    anthropic: () => anthropicOk(readerJson()),
  });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.proposed, 1);
  const order = h.events.filter((e) => e !== "rpc:document_intake_worker_claim");
  assertEquals(order.slice(0, 4), ["download", "rpc:document_intake_worker_dispatch", "fetch:anthropic", "rpc:document_intake_worker_returned"]);
  const dispatch = h.rpcArgs("document_intake_worker_dispatch")[0];
  assertEquals([dispatch.p_run, dispatch.p_fence, dispatch.p_stage, dispatch.p_provider, dispatch.p_model], [RUN, FENCE, "reader", "anthropic", "claude-sonnet-5"]);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.stage_status.jev.state, "not_authorized");
  // Unique, strong code match (last + first name) is proposed without Jev.
  assertEquals(result.candidates[0].subject_id, JANE_A);
  assertEquals(result.candidates.at(-1), { kind: "none", catalog_code: "unknown", subject_id: null, label: "No safe destination" });
  assertEquals(result.proposed_candidate, 0);
});

Deno.test("a timeout after dispatch marks the run uncertain and never re-sends", async () => {
  const h = harness({
    claim: await claim(),
    anthropic: () => {
      throw new DOMException("The signal has been aborted", "TimeoutError");
    },
  });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.uncertain, 1);
  assertEquals(h.events.filter((e) => e === "fetch:anthropic").length, 1);
  const failCall = h.rpcArgs("document_intake_worker_fail")[0];
  assertEquals([failCall.p_code, failCall.p_uncertain], ["reader_outcome_unknown", true]);
  assertEquals(h.rpcArgs("document_intake_worker_returned").length, 0);
  assertEquals(h.published().length, 0);
  assert(h.events.indexOf("rpc:document_intake_worker_dispatch") < h.events.indexOf("fetch:anthropic"));
});

Deno.test("reader HTTP error with a response: returned, then a definite failure", async () => {
  const h = harness({ claim: await claim(), anthropic: () => new Response("{}", { status: 529 }) });
  await runProcessorTick(h.deps);
  assertEquals(h.rpcArgs("document_intake_worker_returned").length, 1);
  assertEquals(h.rpcArgs("document_intake_worker_fail")[0].p_code, "reader_http_529");
  assertEquals(h.rpcArgs("document_intake_worker_fail")[0].p_uncertain, false);
});

Deno.test("invalid reader JSON is a definite failure", async () => {
  const h = harness({
    claim: await claim(),
    anthropic: () => new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] }), { status: 200 }),
  });
  await runProcessorTick(h.deps);
  assertEquals(h.rpcArgs("document_intake_worker_fail")[0].p_code, "reader_invalid_output");
});

Deno.test("Jev is not called for a PHI type when jev_phi_enabled is off", async () => {
  const h = harness({
    claim: await claim({ policy: policy({ enabled: true, jev_enabled: true, jev_phi_enabled: false }) }),
    anthropic: () => anthropicOk(readerJson()),
    typesafe: () => new Response("{}", { status: 200 }),
  });
  await runProcessorTick(h.deps);
  assert(!h.events.includes("fetch:typesafe"));
  assertEquals(h.rpcArgs("document_intake_worker_dispatch").map((a) => a.p_stage), ["reader"]);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.stage_status.jev, { state: "not_authorized", reason: "Jev is not authorized for health information" });
});

Deno.test("two candidates with the same name: no proposal and a same_name warning", async () => {
  const h = harness({
    claim: await claim({ policy: policy({ enabled: true, jev_enabled: false }) }),
    anthropic: () => anthropicOk(readerJson()),
    subjects: {
      ...SUBJECTS_ONE_JANE,
      residents: [
        { id: JANE_A, first_name: "Jane", last_name: "Doe", preferred_name: null, date_of_birth: "1940-01-01" },
        { id: JANE_B, first_name: "JANE", last_name: "Doé", preferred_name: null, date_of_birth: "1951-03-03" },
      ],
    },
  });
  await runProcessorTick(h.deps);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.proposed_candidate, null);
  assert(result.warnings.some((w) => w.code === "same_name"));
  assertEquals(result.candidates.length, 3);
});

Deno.test("payment evidence never goes to Jev", async () => {
  const h = harness({
    claim: await claim(),
    anthropic: () => anthropicOk(readerJson({ catalog_code: "payment_evidence", suggested_title: "Deposit slip" })),
    typesafe: () => new Response("{}", { status: 200 }),
  });
  await runProcessorTick(h.deps);
  assert(!h.events.includes("fetch:typesafe"));
  assert(!h.events.includes("rpc:document_intake_worker_subjects"));
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.catalog_code, "payment_evidence");
  assertEquals(result.stage_status.jev.state, "not_applicable");
  assert(result.warnings.some((w) => w.code === "payment_evidence"));
  assertEquals(result.candidates, [{ kind: "none", catalog_code: "unknown", subject_id: null, label: "No safe destination" }]);
});

Deno.test("Jev answers and probabilities are stored verbatim; Jev sees only the short list", async () => {
  const answers = {
    destination: { type: "choice", choice: "c0", probabilities: { c0: 0.8731, none: 0.1269 }, confidence: 0.61 },
    legible_complete: { type: "noul", noul: 0.912 },
    signed: { type: "noul", noul: 0.5 },
  } as const;
  let sent: Record<string, unknown> = {};
  const h = harness({
    claim: await claim(),
    anthropic: () => anthropicOk(readerJson()),
    typesafe: (body) => {
      sent = body as Record<string, unknown>;
      return new Response(JSON.stringify({ model: "jev-2026-09", answers, usage: { input_tokens: 300 } }), { status: 200 });
    },
  });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.proposed, 1);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.jev as unknown, { model: "jev-2026-09", questions_version: "intake-v1", answers });
  assertEquals(result.stage_status.jev, { state: "ran" });
  assertEquals(result.proposed_candidate, 0);
  const legible = result.checks.find((c) => c.code === "jev_legible_complete")!;
  assertEquals([legible.result, legible.detail, legible.source], ["pass", "Jev probability of yes: 0.912", "jev"]);
  assertEquals(result.checks.find((c) => c.code === "jev_signed")!.result, "unknown");
  // Only the one matching resident label goes to Jev, never the roster.
  assertEquals((sent.state as Record<string, unknown>).candidates, ["Jane Doe"]);
  assertEquals(Object.keys(sent.questions as object).sort(), ["destination", "legible_complete", "signed"]);
  const order = h.events.filter((e) => e.includes("dispatch") || e.startsWith("fetch:") || e.includes("returned"));
  assertEquals(order, [
    "rpc:document_intake_worker_dispatch",
    "fetch:anthropic",
    "rpc:document_intake_worker_returned",
    "rpc:document_intake_worker_dispatch",
    "fetch:typesafe",
    "rpc:document_intake_worker_returned",
  ]);
});

Deno.test("Jev without a clear margin falls back to the code match; HTTP errors keep the reader proposal", async () => {
  const close = harness({
    claim: await claim(),
    anthropic: () => anthropicOk(readerJson()),
    typesafe: () =>
      new Response(JSON.stringify({ model: "jev", answers: { destination: { type: "choice", choice: "none", probabilities: { c0: 0.45, none: 0.55 } }, legible_complete: { type: "noul", noul: 0.2 } } }), { status: 200 }),
  });
  await runProcessorTick(close.deps);
  const closeResult = close.published()[0];
  assertEquals(closeResult.proposed_candidate, 0);
  assertEquals(closeResult.checks.find((c) => c.code === "jev_legible_complete")!.result, "fail");

  const broken = harness({ claim: await claim(), anthropic: () => anthropicOk(readerJson()), typesafe: () => new Response("", { status: 429 }) });
  await runProcessorTick(broken.deps);
  const brokenResult = broken.published()[0];
  assertValid(brokenResult);
  assertEquals(brokenResult.stage_status.jev, { state: "failed", reason: "rate_limited" });
  assertEquals(brokenResult.outcome, "proposed");
});

Deno.test("a Jev transport error after dispatch is uncertain", async () => {
  const h = harness({
    claim: await claim(),
    anthropic: () => anthropicOk(readerJson()),
    typesafe: () => {
      throw new TypeError("connection reset");
    },
  });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.uncertain, 1);
  const failCall = h.rpcArgs("document_intake_worker_fail")[0];
  assertEquals([failCall.p_code, failCall.p_uncertain], ["jev_outcome_unknown", true]);
  assertEquals(h.published().length, 0);
});

Deno.test("code checks: future document date fails; masked account numbers", async () => {
  const h = harness({
    claim: await claim({ policy: policy({ enabled: true }) }),
    anthropic: () => anthropicOk(readerJson({ document_date: "2027-01-01", summary: "Statement for account 123456789012." })),
  });
  await runProcessorTick(h.deps);
  const [result] = h.published();
  assertValid(result);
  assertEquals(result.checks.find((c) => c.code === "document_date_not_future")!.result, "fail");
  assertEquals(result.checks.find((c) => c.code === "page_count_matches")!.result, "pass");
  assertEquals(result.summary, "Statement for account ****9012.");
  assert(result.warnings.some((w) => w.code === "identifier_masked"));
});

Deno.test("a lost lease on publish stops silently", async () => {
  const h = harness({
    claim: await claim({ policy: null }),
    rpc: { document_intake_worker_complete: { error: { code: "40001", message: "Run lease lost" } } },
  });
  const summary = await runProcessorTick(h.deps);
  assertEquals(summary.lease_lost, 1);
  assertEquals(summary.ok, true);
  assertEquals(h.rpcArgs("document_intake_worker_fail").length, 0);
});

Deno.test("requests without the cron secret are refused", async () => {
  const h = harness({ claim: await claim() });
  const refused = await handleProcessorRequest(new Request("http://x", { method: "POST" }), h.deps);
  assertEquals(refused.status, 401);
  assertEquals(h.events.length, 0);
  const allowed = await handleProcessorRequest(new Request("http://x", { method: "POST", headers: { "x-cron-secret": SECRET } }), h.deps);
  assertEquals(allowed.status, 200);
  const body = await allowed.json();
  assertEquals([body.ok, body.claimed, body.blocked], [true, 1, 0]);
});
