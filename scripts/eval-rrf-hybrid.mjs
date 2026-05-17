#!/usr/bin/env node
/**
 * eval-rrf-hybrid.mjs (KB-NEXT-04)
 *
 * Spins up a vanilla pg17 + pgvector container, applies the full migration
 * chain, seeds a tiny KB corpus, and runs canned queries that exercise the
 * RRF fusion path of `retrieve_evidence_hybrid`.
 *
 * Acceptance: for every query we assert that the *expected* chunk appears
 * in the top match_count results. We do NOT call OpenAI — embeddings are
 * deterministic test vectors so semantic rank is predictable.
 *
 * Run from repo root:
 *   node scripts/eval-rrf-hybrid.mjs
 *
 * Idempotent: cleans up its container on success or failure.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const CONTAINER = `haven-rrf-eval-${Date.now()}`;
const PORT = process.env.RRF_EVAL_PG_PORT ? Number(process.env.RRF_EVAL_PG_PORT) : 55436;
const PG_IMAGE = "pgvector/pgvector:pg17";

// Migrations the isolation harness already skips; same surface here.
const SKIP_BAD = new Set([
  "233_audit_p1_db_remediation.sql",
  "20260514180707_homewood_round2_employee_seed.sql",
  "20260514203302_homewood_round2_ar_intake_may_2026.sql",
]);

const STUB_SQL_PATH = path.join(REPO_ROOT, "scripts", "pg-verify-stub.sql");

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
}

function tryRm() {
  try { execSync(`docker rm -f ${CONTAINER}`, { stdio: "ignore" }); } catch { /* ignore */ }
}

async function waitForPg() {
  for (let i = 0; i < 60; i++) {
    try {
      sh(`docker exec ${CONTAINER} pg_isready -U postgres -d postgres -h 127.0.0.1`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Postgres never became ready");
}

function psql(sqlOrFile, fromFile = false) {
  const args = fromFile
    ? ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"]
    : ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sqlOrFile];
  const r = spawnSync("docker", args, {
    input: fromFile ? sqlOrFile : undefined,
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    throw new Error(`psql failed (exit ${r.status})\nSTDERR:\n${r.stderr}\nSTDOUT:\n${r.stdout}`);
  }
  return r.stdout;
}

async function applyMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !SKIP_BAD.has(f))
    .sort();
  let lastOk = "(none)";
  for (const f of files) {
    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8");
    try {
      psql(body, true);
      lastOk = f;
    } catch (err) {
      throw new Error(`migration FAIL at ${f} (last ok: ${lastOk}):\n${err.message}`);
    }
  }
}

function makeEmbedding(seed) {
  // Deterministic 1536-dim pseudo-embedding for test isolation.
  // Seed-derived: each dim = sin(seed * (i+1)) so two different seeds give
  // different but stable vectors. Normalize to unit length so cosine has
  // predictable behavior.
  const v = new Array(1536);
  let norm = 0;
  for (let i = 0; i < 1536; i++) {
    v[i] = Math.sin(seed * (i + 1) * 0.01);
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1536; i++) v[i] /= norm;
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}

async function seed() {
  const org = "11111111-1111-1111-1111-111111111111";
  const docA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // semantic-friendly
  const docB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // keyword-friendly
  const docC = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // both

  // Org row must exist before FK insert.
  psql(`
    INSERT INTO public.organizations (id, name)
    VALUES ('${org}', 'RRF Eval Org')
    ON CONFLICT (id) DO NOTHING;
  `, false);

  psql(`
    INSERT INTO public.documents (id, workspace_id, title, audience, status, raw_text, created_at)
    VALUES
      ('${docA}', '${org}', 'Fall Prevention Policy',      'company_wide', 'published', 'fall prevention text', now()),
      ('${docB}', '${org}', 'Medication Pass Procedure',   'company_wide', 'published', 'medication pass text', now()),
      ('${docC}', '${org}', 'Resident Assessment Form 1823','company_wide', 'published', 'assessment form 1823', now())
    ON CONFLICT (id) DO NOTHING;
  `, false);

  // Deterministic embeddings — different seeds give predictable cosine.
  const embA = makeEmbedding(1);   // closest to query A
  const embB = makeEmbedding(50);  // far from query A
  const embC = makeEmbedding(25);  // medium

  psql(`
    INSERT INTO public.chunks (id, document_id, workspace_id, chunk_index, content, content_stripped, chunk_type, section_title, embedding)
    VALUES
      (gen_random_uuid(), '${docA}', '${org}', 0, 'When a resident falls without injury, staff must complete a Level 1 incident report within 24 hours.', 'When a resident falls without injury staff must complete a Level 1 incident report within 24 hours', 'narrative', 'Reporting', '${embA}'),
      (gen_random_uuid(), '${docB}', '${org}', 0, 'Medication administration: verify five rights - right patient, right drug, right dose, right route, right time. Document on the eMAR immediately after pass.', 'Medication administration verify five rights right patient right drug right dose right route right time Document on the eMAR immediately after pass', 'narrative', 'Procedure', '${embB}'),
      (gen_random_uuid(), '${docC}', '${org}', 0, 'Form 1823 must be signed by the resident physician within 30 days prior to admission. Required for all Florida ALF residents.', 'Form 1823 must be signed by the resident physician within 30 days prior to admission Required for all Florida ALF residents', 'narrative', 'Florida AHCA', '${embC}')
    ON CONFLICT DO NOTHING;
  `, false);

  return { org, docA, docB, docC, embA, embB, embC };
}

async function runEval({ org, embA, embC, docA, docB, docC }) {
  const cases = [
    {
      name: "semantic-leans-A keyword-matches-A",
      embedding: embA,
      keyword: "fall incident report",
      expectedTopDoc: docA,
    },
    {
      name: "semantic-leans-C keyword-matches-B",
      embedding: embC,
      keyword: "medication pass eMAR",
      // RRF should still surface B because keyword rank #1 contributes 1/(60+1)
      // which can beat a #2 semantic that contributes 1/(60+2).
      expectedInTopK: docB,
    },
    {
      name: "form-1823 lookup (keyword-only)",
      embedding: embA, // adversarial: dense vector disagrees
      keyword: "Form 1823 Florida ALF admission",
      expectedInTopK: docC,
    },
  ];
  const failures = [];
  for (const c of cases) {
    const safeKeyword = c.keyword.replace(/'/g, "''");
    const sql = `
      SELECT document_id, source_title, rrf_score, sem_rank, kw_rank
      FROM public.retrieve_evidence_hybrid(
        '${c.embedding}'::text,
        '${safeKeyword}'::text,
        'nurse'::text,
        5,
        0.0,
        60,
        '${org}'::uuid
      )
      ORDER BY rrf_score DESC;
    `;
    const out = psql(sql, false);
    const lines = out.split("\n").filter((l) => l.includes("-") && l.includes("|"));
    const docs = lines.map((l) => l.split("|")[0].trim());
    const top = docs[0];
    const inTopK = c.expectedInTopK ? docs.includes(c.expectedInTopK) : null;
    const topOk = c.expectedTopDoc ? top === c.expectedTopDoc : null;
    const pass = (c.expectedTopDoc ? topOk : true) && (c.expectedInTopK ? inTopK : true);
    console.log(`${pass ? "[PASS]" : "[FAIL]"} ${c.name}`);
    console.log(`         top=${top ?? "(none)"} all=${JSON.stringify(docs)}`);
    if (!pass) failures.push(c.name);
  }
  if (failures.length > 0) {
    throw new Error(`RRF eval failures: ${failures.join(", ")}`);
  }
  console.log(`\nTotal: ${cases.length}  Pass: ${cases.length - failures.length}  Fail: ${failures.length}`);
}

async function main() {
  tryRm();
  console.log(`[eval-rrf-hybrid] starting ${CONTAINER} on port ${PORT}`);
  try {
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -p ${PORT}:5432 ${PG_IMAGE}`,
      { stdio: "inherit" },
    );
  } catch (err) {
    console.error("[eval-rrf-hybrid] docker run failed:\n", err.message);
    process.exit(2);
  }
  try {
    await waitForPg();
    psql("CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    console.log("[eval-rrf-hybrid] applying pg-verify-stub…");
    psql(fs.readFileSync(STUB_SQL_PATH, "utf-8"), true);
    console.log("[eval-rrf-hybrid] applying migrations…");
    await applyMigrations();
    console.log("[eval-rrf-hybrid] seeding…");
    const fixture = await seed();
    console.log("[eval-rrf-hybrid] running queries…");
    await runEval(fixture);
    console.log("[eval-rrf-hybrid] OK");
  } catch (err) {
    console.error("[eval-rrf-hybrid] FAIL:", err.message);
    tryRm();
    process.exit(1);
  } finally {
    tryRm();
  }
}

main();
