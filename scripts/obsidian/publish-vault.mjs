#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { compileVault, DEFAULT_VAULT_PATH } from "./lib/vault-compiler.mjs";

const DEFAULT_COMPILER_VERSION = "obsidian-memory-compiler-v1";

function formatError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }
  if (error && typeof error === "object") {
    return {
      ...error,
      message: error.message ?? JSON.stringify(error),
    };
  }
  return { message: String(error) };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) process.env[key] = rest.join("=");
  }
}

async function fetchAllRows(queryFactory) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function upsertDocument(admin, payload) {
  const { data: existing, error: existingError } = await admin
    .from("documents")
    .select("id,canonical_slug")
    .eq("workspace_id", payload.workspace_id)
    .eq("canonical_slug", payload.canonical_slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { data, error } = await admin
      .from("documents")
      .update(payload)
      .eq("id", existing.id)
      .select("id,canonical_slug,title")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await admin
    .from("documents")
    .insert(payload)
    .select("id,canonical_slug,title")
    .single();
  if (error) throw error;
  return data;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildDocumentStatus(frontmatter) {
  switch (frontmatter.status) {
    case "active":
      return "published";
    case "review_pending":
      return "pending_review";
    default:
      return "pending_review";
  }
}

function buildDocumentPayload(doc, workspaceId) {
  return {
    workspace_id: workspaceId,
    title: doc.title,
    source: "obsidian_control_plane",
    source_system: "obsidian",
    source_path: doc.relPath,
    canonical_slug: doc.canonicalSlug,
    mime_type: "text/markdown",
    raw_text: doc.body,
    markdown_text: doc.body,
    conversion_method: "passthrough_md",
    audience: "company_wide",
    status: buildDocumentStatus(doc.frontmatter),
    lifecycle_status: doc.frontmatter.status,
    doc_type: doc.docType,
    facility_scope: doc.frontmatter.facility_scope,
    facility_tags: doc.frontmatter.facility_tags ?? [],
    entity_tags: doc.frontmatter.entity_tags ?? [],
    role_tags: doc.frontmatter.roles ?? [],
    topic_tags: doc.frontmatter.topics ?? [],
    alias_terms: doc.aliases,
    grace_priority: doc.frontmatter.grace_priority,
    grace_answerable: Boolean(doc.frontmatter.grace_answerable),
    trust_rank: doc.frontmatter.trust_rank ?? null,
    effective_date: doc.frontmatter.effective_date ?? null,
    review_date: doc.frontmatter.review_date ?? null,
    owner_name: doc.frontmatter.owner ?? null,
    compiled_at: new Date().toISOString(),
    compiler_version: DEFAULT_COMPILER_VERSION,
    word_count: doc.wordCount,
    summary: doc.body.split(/\n+/).find((line) => line.trim())?.slice(0, 500) ?? null,
    metadata: {
      source_of_truth: doc.frontmatter.source_of_truth,
      vault_path: doc.relPath,
      frontmatter: doc.frontmatter,
      wikilinks: doc.wikiLinks,
    },
  };
}

async function resolveWorkspaceId(admin) {
  const explicit = process.env.OBSIDIAN_WORKSPACE_ID ?? process.env.WORKSPACE_ID ?? null;
  if (explicit) return explicit;

  const { data, error } = await admin
    .from("organizations")
    .select("id,name")
    .ilike("name", "%Circle of Life%")
    .limit(20);

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) {
    throw new Error("Could not resolve Circle of Life organization id. Set OBSIDIAN_WORKSPACE_ID.");
  }
  return rows[0].id;
}

async function main() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));

  const vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH;
  const dryRun = process.argv.includes("--dry-run");
  const manifest = compileVault(vaultPath);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const workspaceId = await resolveWorkspaceId(admin);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dry_run: true,
          workspace_id: workspaceId,
          summary: manifest.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const runInsert = await admin
    .from("memory_compiler_runs")
    .insert({
      workspace_id: workspaceId,
      source_system: "obsidian",
      vault_path: vaultPath,
      status: "running",
      compiler_version: DEFAULT_COMPILER_VERSION,
      documents_seen: manifest.documents.length,
      metadata: {
        generated_at: manifest.generatedAt,
      },
    })
    .select("id")
    .single();

  if (runInsert.error || !runInsert.data?.id) {
    throw runInsert.error ?? new Error("Could not create memory_compiler_runs row.");
  }

  const runId = runInsert.data.id;

  try {
    const documentPayloads = manifest.documents.map((doc) => buildDocumentPayload(doc, workspaceId));
    const documentRows = [];
    for (const payload of documentPayloads) {
      documentRows.push(await upsertDocument(admin, payload));
    }
    const documentIdBySlug = new Map(documentRows.map((row) => [row.canonical_slug, row.id]));

    const missing = manifest.documents
      .map((doc) => doc.canonicalSlug)
      .filter((slug) => !documentIdBySlug.has(slug));
    if (missing.length > 0) {
      throw new Error(`Publish missing document ids for slugs: ${missing.join(", ")}`);
    }

    const documentIds = manifest.documents.map((doc) => documentIdBySlug.get(doc.canonicalSlug));

    await Promise.all([
      admin.from("chunks").delete().in("document_id", documentIds),
      admin.from("document_aliases").delete().in("document_id", documentIds),
      admin.from("document_relationships").delete().or(documentIds.map((id) => `from_document_id.eq.${id},to_document_id.eq.${id}`).join(",")),
      admin.from("document_planning_hints").delete().in("document_id", documentIds),
    ]);

    const chunkPayloads = manifest.documents.flatMap((doc) =>
      doc.chunks.map((chunk) => ({
        document_id: documentIdBySlug.get(doc.canonicalSlug),
        workspace_id: workspaceId,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        content_stripped: chunk.contentStripped,
        token_count: Math.max(1, Math.ceil(chunk.contentStripped.length / 4)),
        chunk_type: chunk.chunkType,
        section_title: chunk.sectionTitle,
        metadata: chunk.metadata,
      })),
    );
    if (chunkPayloads.length > 0) {
      const chunkInsert = await admin.from("chunks").insert(chunkPayloads);
      if (chunkInsert.error) throw chunkInsert.error;
    }

    const aliasPayloads = uniqueBy(
      manifest.documents.flatMap((doc) =>
        doc.aliases.map((alias) => ({
          workspace_id: workspaceId,
          document_id: documentIdBySlug.get(doc.canonicalSlug),
          alias,
          alias_kind: alias === doc.title.toLowerCase() ? "derived" : "frontmatter",
        })),
      ),
      (row) => `${row.document_id}:${row.alias}`,
    );
    if (aliasPayloads.length > 0) {
      const aliasInsert = await admin.from("document_aliases").insert(aliasPayloads);
      if (aliasInsert.error) throw aliasInsert.error;
    }

    const planningHintPayloads = manifest.documents
      .filter((doc) => doc.planningHint)
      .map((doc) => ({
        workspace_id: workspaceId,
        document_id: documentIdBySlug.get(doc.canonicalSlug),
        route_bias: doc.planningHint.routeBias,
        clarification_prompt: doc.planningHint.clarificationPrompt,
        forbidden_substitutions: doc.planningHint.forbiddenSubstitutions,
        preferred_answer_shape: doc.planningHint.preferredAnswerShape,
        preferred_live_tables: doc.planningHint.preferredLiveTables,
        metadata: doc.planningHint.metadata,
      }));
    if (planningHintPayloads.length > 0) {
      const hintsUpsert = await admin
        .from("document_planning_hints")
        .upsert(planningHintPayloads, { onConflict: "document_id" });
      if (hintsUpsert.error) throw hintsUpsert.error;
    }

    const relationshipPayloads = uniqueBy(
      manifest.relationships
        .map((relationship) => {
          const fromId = documentIdBySlug.get(relationship.fromSlug);
          const toId = documentIdBySlug.get(relationship.toSlug);
          if (!fromId || !toId) return null;
          return {
            workspace_id: workspaceId,
            from_document_id: fromId,
            to_document_id: toId,
            relationship_type: relationship.relationshipType,
            metadata: relationship.metadata,
          };
        })
        .filter(Boolean),
      (row) => `${row.from_document_id}:${row.relationship_type}:${row.to_document_id}:${JSON.stringify(row.metadata)}`,
    );
    if (relationshipPayloads.length > 0) {
      const relInsert = await admin.from("document_relationships").insert(relationshipPayloads);
      if (relInsert.error) throw relInsert.error;
    }

    await admin
      .from("knowledge_contradictions")
      .delete()
      .eq("workspace_id", workspaceId)
      .contains("metadata", { source: "obsidian_compiler" });

    const contradictionPayloads = manifest.contradictions.map((contradiction) => ({
      workspace_id: workspaceId,
      left_document_id: contradiction.leftSlug ? documentIdBySlug.get(contradiction.leftSlug) ?? null : null,
      right_document_id: contradiction.rightSlug ? documentIdBySlug.get(contradiction.rightSlug) ?? null : null,
      severity: contradiction.severity,
      contradiction_type: contradiction.contradictionType,
      description: contradiction.description,
      status: "open",
      metadata: {
        source: "obsidian_compiler",
        ...contradiction.metadata,
      },
    }));
    if (contradictionPayloads.length > 0) {
      const contradictionInsert = await admin.from("knowledge_contradictions").insert(contradictionPayloads);
      if (contradictionInsert.error) throw contradictionInsert.error;
    }

    const finish = await admin
      .from("memory_compiler_runs")
      .update({
        status: manifest.contradictions.length > 0 ? "partial" : "succeeded",
        documents_compiled: manifest.documents.length,
        contradictions_found: manifest.contradictions.length,
        completed_at: new Date().toISOString(),
        metadata: {
          generated_at: manifest.generatedAt,
          summary: manifest.summary,
        },
      })
      .eq("id", runId);
    if (finish.error) throw finish.error;

    console.log(
      JSON.stringify(
        {
          ok: true,
          workspace_id: workspaceId,
          run_id: runId,
          summary: manifest.summary,
          published_documents: manifest.documents.length,
          contradictions_found: manifest.contradictions.length,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await admin
      .from("memory_compiler_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        metadata: {
          generated_at: manifest.generatedAt,
          error: formatError(error),
        },
      })
      .eq("id", runId);
    throw error;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: formatError(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
