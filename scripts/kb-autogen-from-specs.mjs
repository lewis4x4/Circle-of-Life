#!/usr/bin/env node
/**
 * kb-autogen-from-specs.mjs (KB-NEXT-07, engineering-only)
 *
 * Walks docs/specs/*.md and emits one KB document per spec, chunked by
 * top-level heading (## or larger). Optionally embeds via OpenAI and inserts
 * into the live KB tables (public.documents + public.chunks) via the
 * Supabase service-role client.
 *
 * Use cases:
 *   - Bootstrap a fresh org's KB with the spec corpus (engineering / demo).
 *   - Regenerate after a spec rewrite.
 *
 * This script is intentionally NOT wired into a cron or app surface — owners
 * use the Knowledge Admin UI for production ingest. Per repo convention,
 * production deploys do not run this automatically.
 *
 * Usage:
 *   node scripts/kb-autogen-from-specs.mjs --workspace-id <uuid> --dry-run
 *   node scripts/kb-autogen-from-specs.mjs --workspace-id <uuid>   # actually writes
 *
 * Required env (for non-dry-run):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY    (only if --no-embed not set)
 *
 * Flags:
 *   --workspace-id <uuid>   target organization id (required)
 *   --dry-run               print plan, don't write
 *   --no-embed              skip embedding generation (chunks inserted with
 *                           NULL embedding; semantic search will miss them
 *                           until a backfill runs)
 *   --only <slug>           process a single spec file (e.g. 06-medication)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const REPO_ROOT = process.cwd();
const SPECS_DIR = path.join(REPO_ROOT, "docs", "specs");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) return true;
  return v;
}

const workspaceId = flag("--workspace-id");
const dryRun = !!flag("--dry-run");
const noEmbed = !!flag("--no-embed");
const onlyArg = typeof flag("--only") === "string" ? flag("--only") : null;

if (!workspaceId || workspaceId === true) {
  console.error("--workspace-id <uuid> is required");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required when not --dry-run");
  process.exit(1);
}
if (!noEmbed && !dryRun && !OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY required (or pass --no-embed)");
  process.exit(1);
}

/**
 * Spec slug -> compliance category mapping. Heuristic but stable.
 * Anything not listed defaults to 'general'.
 */
const SPEC_COMPLIANCE_MAP = {
  "06-medication-management.md": "medication_admin_policy",
  "07-incident-reporting.md": "sop",
  "08-compliance-engine.md": "ahca_regulation",
  "09-infection-control.md": "sop",
  "10-quality-metrics.md": "sop",
  "11-staff-management.md": "sop",
  "12-training-competency.md": "training_material",
  "14-dietary-nutrition.md": "dietary_policy",
  "18-insurance-risk-finance.md": "facility_policy",
  "21-family-portal.md": "facility_policy",
  "25-resident-assurance-engine.md": "sop",
  "00-foundation-regulatory.md": "ahca_regulation",
};

function specFiles() {
  if (!fs.existsSync(SPECS_DIR)) {
    console.error(`Specs dir not found: ${SPECS_DIR}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !f.startsWith("README"))
    .filter((f) => !f.toUpperCase().includes("ROADMAP") && !f.toUpperCase().includes("HANDOFF"));
  if (onlyArg) {
    return files.filter((f) => f.includes(onlyArg));
  }
  return files;
}

/**
 * Splits a markdown spec into chunks at each ## heading. Returns
 * [{ section_title, content }].
 * Chunks > 2000 chars are split on paragraph boundaries to keep embeddings
 * focused.
 */
function chunkMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  let currentTitle = "Overview";
  let buf = [];
  function flush() {
    const content = buf.join("\n").trim();
    if (content.length === 0) return;
    if (content.length <= 2000) {
      out.push({ section_title: currentTitle, content });
      return;
    }
    const paragraphs = content.split(/\n{2,}/);
    let cur = "";
    for (const p of paragraphs) {
      if ((cur + "\n\n" + p).length > 2000 && cur.length > 0) {
        out.push({ section_title: currentTitle, content: cur.trim() });
        cur = p;
      } else {
        cur = cur ? cur + "\n\n" + p : p;
      }
    }
    if (cur.trim().length > 0) out.push({ section_title: currentTitle, content: cur.trim() });
  }
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      flush();
      currentTitle = h1[1].trim();
      buf = [];
    } else if (h2) {
      flush();
      currentTitle = h2[1].trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!res.ok) {
    throw new Error(`embedding HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.data?.[0]?.embedding ?? null;
}

async function upsertDocument(supabase, file, body, title) {
  const compliance = SPEC_COMPLIANCE_MAP[file] ?? "general";
  // Stable id per (workspace, slug) so re-runs upsert in place.
  const idSeed = `${workspaceId}::${file}`;
  const stableId = crypto.createHash("sha256").update(idSeed).digest("hex");
  const docId = [
    stableId.slice(0, 8),
    stableId.slice(8, 12),
    "4" + stableId.slice(13, 16),
    "8" + stableId.slice(17, 20),
    stableId.slice(20, 32),
  ].join("-");
  const summary = body.split("\n").slice(0, 8).join(" ").slice(0, 400);
  const payload = {
    id: docId,
    workspace_id: workspaceId,
    title,
    source: "kb_autogen_from_specs",
    audience: "company_wide",
    status: "published",
    raw_text: body,
    summary,
    word_count: body.split(/\s+/).filter(Boolean).length,
    compliance_category: compliance,
    metadata: { source_spec: file },
  };
  if (dryRun) {
    console.log(`  DRY-RUN upsert document ${docId} (${file}) [${compliance}]`);
    return docId;
  }
  const { error } = await supabase.from("documents").upsert(payload, { onConflict: "id" });
  if (error) throw error;
  // Wipe stale chunks for this doc — we're re-generating from source-of-truth.
  const { error: delErr } = await supabase.from("chunks").delete().eq("document_id", docId);
  if (delErr) throw delErr;
  return docId;
}

async function insertChunks(supabase, docId, chunks) {
  if (dryRun) {
    console.log(`  DRY-RUN insert ${chunks.length} chunks for ${docId}`);
    return;
  }
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    let embedding = null;
    if (!noEmbed) {
      try {
        embedding = await embed(`${ch.section_title}\n\n${ch.content}`);
      } catch (err) {
        console.warn(`    embed fail (chunk ${i}): ${err.message}`);
      }
    }
    rows.push({
      document_id: docId,
      workspace_id: workspaceId,
      chunk_index: i,
      content: ch.content,
      content_stripped: ch.content.replace(/[^a-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim(),
      chunk_type: "section",
      section_title: ch.section_title,
      embedding: embedding ? `[${embedding.join(",")}]` : null,
    });
  }
  // Insert in slices of 25 so a partial fail doesn't drop the lot.
  for (let i = 0; i < rows.length; i += 25) {
    const slice = rows.slice(i, i + 25);
    const { error } = await supabase.from("chunks").insert(slice);
    if (error) throw error;
  }
}

async function main() {
  let supabase = null;
  if (!dryRun) {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  const files = specFiles();
  console.log(`[kb-autogen] workspace=${workspaceId} files=${files.length} dryRun=${dryRun} embed=${!noEmbed}`);
  let okCount = 0;
  let failCount = 0;
  for (const file of files) {
    const md = fs.readFileSync(path.join(SPECS_DIR, file), "utf-8");
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, "");
    const chunks = chunkMarkdown(md);
    console.log(`\n[${file}] title="${title}" chunks=${chunks.length}`);
    try {
      const docId = await upsertDocument(supabase, file, md, title);
      await insertChunks(supabase, docId, chunks);
      okCount++;
    } catch (err) {
      console.error(`  FAIL ${file}: ${err.message}`);
      failCount++;
    }
  }
  console.log(`\n[kb-autogen] done ok=${okCount} fail=${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[kb-autogen] uncaught:", err);
  process.exit(2);
});
