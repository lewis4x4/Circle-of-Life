/**
 * Knowledge Base — document ingestion (chunk, embed, summarize).
 * POST multipart (file upload) or JSON `{ document_id }` (re-index).
 * Auth: user JWT. Roles: owner, org_admin, facility_admin.
 */
import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import mammoth from "npm:mammoth@1.8.0";
import pdfParse from "npm:pdf-parse@1.1.1";
import XLSX from "npm:xlsx@0.18.5";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const CHUNK_TARGET_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 50;
const SECTION_CHUNK_TARGET = 2000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const EMBEDDING_MODEL = "text-embedding-3-small";

const UPLOAD_ROLES = ["owner", "org_admin", "facility_admin"] as const;

async function extractText(buffer: ArrayBuffer, kind: string): Promise<string> {
  switch (kind) {
    case "pdf": {
      const parsed = await pdfParse(Buffer.from(buffer));
      return parsed.text ?? "";
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return result.value ?? "";
    }
    case "spreadsheet": {
      const wb = XLSX.read(Buffer.from(buffer), { type: "buffer" });
      return wb.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }).trim();
        return csv ? `Sheet: ${name}\n${csv}` : "";
      })
        .filter(Boolean)
        .join("\n\n");
    }
    default:
      return new TextDecoder().decode(buffer);
  }
}

interface ChunkResult {
  content: string;
  tokenCount: number;
  type: "section" | "paragraph";
  sectionTitle: string | null;
  pageNumber: number | null;
  parentIndex: number | null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function semanticChunk(text: string): ChunkResult[] {
  const sections: ChunkResult[] = [];
  const paragraphs: ChunkResult[] = [];
  const paras = text.split(/\n\n+/).filter((p) => p.trim());

  let currentSection = "";
  let currentSectionTitle: string | null = null;
  let currentSectionTokens = 0;

  for (const para of paras) {
    const paraTokens = estimateTokens(para);
    const isHeading = /^#{1,3}\s/.test(para) || /^[A-Z][A-Z\s:]{3,}$/.test(para.trim());

    if (isHeading) {
      if (currentSection.trim()) {
        sections.push({
          content: currentSection.trim(),
          tokenCount: currentSectionTokens,
          type: "section",
          sectionTitle: currentSectionTitle,
          pageNumber: null,
          parentIndex: null,
        });
      }
      currentSectionTitle = para.replace(/^#+\s*/, "").trim();
      currentSection = para + "\n\n";
      currentSectionTokens = paraTokens;
      continue;
    }

    currentSection += para + "\n\n";
    currentSectionTokens += paraTokens;

    if (currentSectionTokens > SECTION_CHUNK_TARGET) {
      sections.push({
        content: currentSection.trim(),
        tokenCount: currentSectionTokens,
        type: "section",
        sectionTitle: currentSectionTitle,
        pageNumber: null,
        parentIndex: null,
      });
      currentSection = "";
      currentSectionTokens = 0;
    }
  }

  if (currentSection.trim()) {
    sections.push({
      content: currentSection.trim(),
      tokenCount: currentSectionTokens,
      type: "section",
      sectionTitle: currentSectionTitle,
      pageNumber: null,
      parentIndex: null,
    });
  }

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const sectionParas = section.content.split(/\n\n+/).filter((p) => p.trim());
    let buf = "";
    let bufferTokens = 0;

    for (const p of sectionParas) {
      const pTokens = estimateTokens(p);
      if (bufferTokens + pTokens > CHUNK_TARGET_TOKENS && buf.trim()) {
        paragraphs.push({
          content: buf.trim(),
          tokenCount: bufferTokens,
          type: "paragraph",
          sectionTitle: section.sectionTitle,
          pageNumber: null,
          parentIndex: si,
        });
        const overlapChars = CHUNK_OVERLAP_TOKENS * 4;
        buf = buf.slice(-overlapChars) + "\n\n" + p;
        bufferTokens = estimateTokens(buf);
      } else {
        buf += (buf ? "\n\n" : "") + p;
        bufferTokens += pTokens;
      }
    }

    if (buf.trim()) {
      paragraphs.push({
        content: buf.trim(),
        tokenCount: bufferTokens,
        type: "paragraph",
        sectionTitle: section.sectionTitle,
        pageNumber: null,
        parentIndex: si,
      });
    }
  }

  return [...sections, ...paragraphs];
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 20;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Embedding API: ${res.status}`);
    const data = await res.json();
    all.push(...data.data.map((d: { embedding: number[] }) => d.embedding));
  }
  return all;
}

async function generateSummary(text: string, title: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Write a 2-3 sentence summary of this document. Be specific.\n\nTitle: "${title}"\n\n${text.slice(0, 6000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

function verifyFileType(header: Uint8Array, kind: string): boolean {
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
  const isOle = header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
  switch (kind) {
    case "pdf":
      return isPdf;
    case "docx":
      return isZip;
    case "spreadsheet":
      return isZip || isOle;
    default:
      return true;
  }
}

/** Haven: facility_admin uploads go to pending_review; owner/org_admin can publish by default. */
function resolveGovernance(
  role: string,
  reqAudience?: string,
  reqStatus?: string,
): { audience: string; status: string } {
  if (role === "facility_admin") {
    return { audience: reqAudience ?? "company_wide", status: "pending_review" };
  }
  return {
    audience: reqAudience ?? "company_wide",
    status: reqStatus ?? "published",
  };
}

async function ingestDocument(
  admin: any, // Edge: KB tables not in generated client schema yet
  documentId: string,
  rawText: string,
  title: string,
  workspaceId: string,
): Promise<number> {
  const chunks = semanticChunk(rawText);
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));
  const sectionChunks = chunks.filter((c) => c.type === "section");
  const paraChunks = chunks.filter((c) => c.type === "paragraph");

  await admin.from("chunks").delete().eq("document_id", documentId);

  const sectionRows = sectionChunks.map((chunk, i) => ({
    document_id: documentId,
    workspace_id: workspaceId,
    chunk_index: i,
    content: chunk.content,
    content_stripped: chunk.content.replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim(),
    token_count: chunk.tokenCount,
    chunk_type: "section",
    section_title: chunk.sectionTitle,
    embedding: `[${embeddings[i]!.join(",")}]`,
  }));

  const batchSize = 10;
  const insertedSections: { id: string; chunk_index: number }[] = [];
  for (let i = 0; i < sectionRows.length; i += batchSize) {
    const { data, error } = await admin
      .from("chunks")
      .insert(sectionRows.slice(i, i + batchSize))
      .select("id, chunk_index");
    if (error) throw new Error(`Section insert: ${error.message}`);
    insertedSections.push(...((data ?? []) as { id: string; chunk_index: number }[]));
  }

  const sectionIdMap = new Map(insertedSections.map((s) => [s.chunk_index, s.id]));
  const embeddingOffset = sectionChunks.length;
  const paraRows = paraChunks.map((chunk, i) => ({
    document_id: documentId,
    workspace_id: workspaceId,
    chunk_index: embeddingOffset + i,
    content: chunk.content,
    content_stripped: chunk.content.replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim(),
    token_count: chunk.tokenCount,
    chunk_type: "paragraph",
    section_title: chunk.sectionTitle,
    parent_chunk_id:
      chunk.parentIndex !== null ? sectionIdMap.get(chunk.parentIndex) ?? null : null,
    embedding: `[${embeddings[embeddingOffset + i]!.join(",")}]`,
  }));

  for (let i = 0; i < paraRows.length; i += batchSize) {
    const { error } = await admin.from("chunks").insert(paraRows.slice(i, i + batchSize));
    if (error) throw new Error(`Paragraph insert: ${error.message}`);
  }

  const summary = await generateSummary(rawText, title);
  await admin
    .from("documents")
    .update({
      summary,
      word_count: rawText.split(/\s+/).filter(Boolean).length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  return chunks.length;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function fileKindFromMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet";
  return "text";
}

Deno.serve(async (req) => {
  const t = withTiming("ingest");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    t.log({ event: "auth_failed", outcome: "blocked", error_message: authError?.message });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const userRole = profile?.app_role ?? "caregiver";
  const orgId = profile?.organization_id as string | undefined;

  if (!orgId) {
    t.log({ event: "no_org", outcome: "blocked" });
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }

  if (!UPLOAD_ROLES.includes(userRole as (typeof UPLOAD_ROLES)[number])) {
    return jsonResponse({ error: "Forbidden: insufficient role" }, 403, origin);
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { document_id?: string };
      const document_id = body.document_id;
      if (!document_id) {
        return jsonResponse({ error: "document_id required" }, 400, origin);
      }

      const { data: doc, error: docErr } = await admin.from("documents").select("*").eq("id", document_id).single();
      if (docErr || !doc) {
        return jsonResponse({ error: "Document not found" }, 404, origin);
      }
      if (doc.workspace_id !== orgId) {
        return jsonResponse({ error: "Forbidden" }, 403, origin);
      }
      if (!doc.raw_text) {
        return jsonResponse({ error: "No raw_text to re-index" }, 400, origin);
      }

      const chunkCount = await ingestDocument(admin, doc.id, doc.raw_text, doc.title, doc.workspace_id);

      await admin.from("document_audit_events").insert({
        actor_user_id: user.id,
        document_id: doc.id,
        document_title_snapshot: doc.title,
        event_type: "reindexed",
        metadata: { chunk_count: chunkCount },
      });

      t.log({ event: "reindex_ok", outcome: "success", document_id: doc.id, chunks: chunkCount });
      return new Response(JSON.stringify({ success: true, document_id: doc.id, chunks: chunkCount }), {
        headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const title = (formData.get("title") as string) || file?.name || "Untitled";
      const audience = (formData.get("audience") as string) || undefined;
      const status = (formData.get("status") as string) || undefined;
      const requestedWs = (formData.get("workspace_id") as string) || undefined;
      const workspaceId = requestedWs && requestedWs === orgId ? requestedWs : orgId;

      if (!file) {
        return jsonResponse({ error: "No file provided" }, 400, origin);
      }
      if (file.size > MAX_FILE_SIZE) {
        return jsonResponse({ error: "File too large (max 50MB)" }, 400, origin);
      }

      const fileBuffer = await file.arrayBuffer();
      const header = new Uint8Array(fileBuffer.slice(0, 4));
      const kind = fileKindFromMime(file.type);

      if (!verifyFileType(header, kind)) {
        return jsonResponse({ error: "File type mismatch (magic bytes)" }, 400, origin);
      }

      const gov = resolveGovernance(userRole, audience, status);

      const rawText = await extractText(fileBuffer, kind);
      if (!rawText.trim()) {
        return jsonResponse({ error: "No text extracted from file" }, 400, origin);
      }

      const storagePath = `kb/${workspaceId}/${crypto.randomUUID()}-${file.name}`;
      const { error: storageErr } = await admin.storage
        .from("documents")
        .upload(storagePath, fileBuffer, { contentType: file.type });
      if (storageErr) {
        console.error("Storage upload failed:", storageErr);
      }

      const { data: doc, error: docInsertErr } = await admin
        .from("documents")
        .insert({
          workspace_id: workspaceId,
          title,
          source: "manual_upload",
          mime_type: file.type,
          raw_text: rawText,
          audience: gov.audience,
          status: gov.status,
          uploaded_by: user.id,
          metadata: {
            storage_bucket: "documents",
            storage_path: storagePath,
            original_filename: file.name,
            upload_kind: kind,
          },
        })
        .select("id, workspace_id, title")
        .single();

      if (docInsertErr || !doc) {
        return jsonResponse({ error: `Insert failed: ${docInsertErr?.message}` }, 500, origin);
      }

      let chunkCount = 0;
      try {
        chunkCount = await ingestDocument(admin, doc.id, rawText, doc.title, doc.workspace_id);
      } catch (ingestErr: unknown) {
        const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
        await admin.from("documents").update({ status: "ingest_failed" }).eq("id", doc.id);
        await admin.from("document_audit_events").insert({
          actor_user_id: user.id,
          document_id: doc.id,
          document_title_snapshot: doc.title,
          event_type: "ingest_failed",
          metadata: { error: msg },
        });
        t.log({ event: "ingest_failed", outcome: "error", error_message: msg });
        return jsonResponse({ error: `Ingestion failed: ${msg}` }, 500, origin);
      }

      await admin.from("document_audit_events").insert({
        actor_user_id: user.id,
        document_id: doc.id,
        document_title_snapshot: doc.title,
        event_type: "uploaded",
        metadata: { chunk_count: chunkCount, file_type: kind, file_size: file.size },
      });

      await admin.from("kb_analytics_events").insert({
        workspace_id: workspaceId,
        event_type: "doc_uploaded",
        user_id: user.id,
        document_id: doc.id,
        metadata: { chunk_count: chunkCount },
      });

      t.log({ event: "upload_ok", outcome: "success", document_id: doc.id, chunks: chunkCount });
      return new Response(
        JSON.stringify({
          success: true,
          document_id: doc.id,
          title: doc.title,
          chunks: chunkCount,
          status: gov.status,
          audience: gov.audience,
        }),
        {
          headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
        },
      );
    }

    return jsonResponse({ error: "Unsupported content type" }, 400, origin);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    t.log({ event: "ingest_error", outcome: "error", error_message: msg });
    return jsonResponse({ error: msg }, 500, origin);
  }
});
