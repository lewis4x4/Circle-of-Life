/**
 * Knowledge Base — document ingestion with Markdown IR pipeline.
 * POST multipart (file upload) or JSON { document_id } (re-index)
 *      or JSON { document_id, action: "regenerate_markdown" } (re-convert from storage).
 * Auth: user JWT. Roles: owner, org_admin, facility_admin.
 *
 * Pipeline: upload → type-specific extraction → Markdown conversion → semantic chunk → embed → summarize → audit
 */
import { Buffer } from "node:buffer";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import mammoth from "npm:mammoth@1.8.0";
import pdfParse from "npm:pdf-parse@1.1.1";
import XLSX from "npm:xlsx@0.18.5";
import TurndownService from "npm:turndown@7.2.0";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHUNK_TARGET_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 50;
const SECTION_CHUNK_TARGET = 2000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const EMBEDDING_MODEL = "text-embedding-3-small";
const LLM_MD_MODEL = "claude-haiku-4-5-20251001";
const LLM_VISION_MODEL = "claude-sonnet-4-5-20250514";
const LLM_MD_MAX_CHARS_PER_PASS = 24_000; // ~6k tokens input
const SCANNED_PDF_MIN_CHARS = 50;
const SCANNED_PDF_MIN_ALPHA_RATIO = 0.3;

const UPLOAD_ROLES = ["owner", "org_admin", "facility_admin"] as const;

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AdminClient = SupabaseClient;

function queueBackgroundTask(task: Promise<unknown>): boolean {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Turndown instance (HTML → Markdown)
// ---------------------------------------------------------------------------
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// ---------------------------------------------------------------------------
// HTML table → Markdown table (string-based, no DOM APIs — Deno-safe)
// Pre-processes HTML to convert <table> blocks before passing to Turndown.
// ---------------------------------------------------------------------------
function htmlTablesToMarkdown(html: string): string {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = [];

    // Extract each <tr> block
    const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trMatches) {
      const cells: string[] = [];
      // Match both <td> and <th> cells
      const cellMatches = tr.match(/<(?:td|th)[\s\S]*?<\/(?:td|th)>/gi) || [];
      for (const cell of cellMatches) {
        // Strip HTML tags, normalize whitespace
        const text = cell
          .replace(/<[^>]*>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\|/g, "\\|");
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return "";

    // Normalize column count
    const maxCols = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => {
      while (r.length < maxCols) r.push("");
      return r;
    });

    // Build Markdown table
    const header = `| ${normalized[0]!.join(" | ")} |`;
    const separator = `| ${normalized[0]!.map(() => "---").join(" | ")} |`;
    const body = normalized
      .slice(1)
      .map((r) => `| ${r.join(" | ")} |`)
      .join("\n");
    return `\n\n${header}\n${separator}\n${body}\n\n`;
  });
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------
type FileKind = "pdf" | "docx" | "spreadsheet" | "markdown" | "text";

function fileKindFromMime(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  return "text";
}

function verifyFileType(header: Uint8Array, kind: FileKind): boolean {
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
  const isOle = header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
  switch (kind) {
    case "pdf": return isPdf;
    case "docx": return isZip;
    case "spreadsheet": return isZip || isOle;
    default: return true;
  }
}

// ---------------------------------------------------------------------------
// Scanned PDF detection
// ---------------------------------------------------------------------------
function isScannedPdf(rawText: string): boolean {
  if (!rawText || rawText.trim().length < SCANNED_PDF_MIN_CHARS) return true;
  const alphaCount = rawText.replace(/[^a-zA-Z0-9]/g, "").length;
  if (rawText.length > 0 && alphaCount / rawText.length < SCANNED_PDF_MIN_ALPHA_RATIO) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Raw text extraction (fallback / pre-Markdown)
// ---------------------------------------------------------------------------
async function extractRawText(buffer: ArrayBuffer, kind: FileKind): Promise<string> {
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
      }).filter(Boolean).join("\n\n");
    }
    default:
      return new TextDecoder().decode(buffer);
  }
}

// ---------------------------------------------------------------------------
// Markdown conversion — per file type
// ---------------------------------------------------------------------------

/**
 * DOCX → Markdown via mammoth (HTML) → turndown.
 * Preserves headings, bold, italic, lists, tables.
 */
async function docxToMarkdown(buffer: ArrayBuffer): Promise<{ markdown: string; method: string }> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
  const html = result.value ?? "";
  if (!html.trim()) return { markdown: "", method: "mammoth_html_turndown" };

  // Pre-process: convert HTML tables to Markdown tables (string-based, no DOM)
  const htmlWithMdTables = htmlTablesToMarkdown(html);
  // Then let Turndown handle everything else (headings, lists, bold, italic, links)
  let md = turndown.turndown(htmlWithMdTables);
  // Normalize excessive blank lines
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return { markdown: md, method: "mammoth_html_turndown" };
}

/**
 * Text-based PDF → raw text → LLM structuring to Markdown.
 * Sends extracted text to Claude Haiku to detect and apply heading levels,
 * tables, lists, and emphasis.
 */
async function textPdfToMarkdown(rawText: string, title: string): Promise<{ markdown: string; method: string }> {
  if (rawText.length <= LLM_MD_MAX_CHARS_PER_PASS) {
    const md = await llmTextToMarkdown(rawText, title);
    return { markdown: md, method: "llm_text_to_md" };
  }

  // Split long documents into page-ish chunks and process in sequence
  const pages = splitTextForBatching(rawText, LLM_MD_MAX_CHARS_PER_PASS);
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const md = await llmTextToMarkdown(pages[i]!, `${title} (section ${i + 1}/${pages.length})`);
    parts.push(md);
  }
  return { markdown: parts.join("\n\n"), method: "llm_text_to_md" };
}

/**
 * Scanned PDF → send PDF bytes to Claude vision → Markdown.
 * Uses the Anthropic document content type for native PDF reading.
 */
async function scannedPdfToMarkdown(buffer: ArrayBuffer, title: string): Promise<{ markdown: string; method: string }> {
  const pdfBase64 = Buffer.from(buffer).toString("base64");

  // Process in a single call if under ~25 pages. Claude handles multi-page PDFs natively.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_VISION_MODEL,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: `Extract ALL text content from this PDF document and convert it to clean, well-structured Markdown.

Rules:
- Preserve ALL content verbatim — do not summarize, rephrase, or omit anything
- Detect and apply heading levels (# ## ###) based on the document structure
- Convert any tabular data into Markdown tables with proper headers and alignment
- Preserve bullet/numbered lists with correct nesting
- Mark bold (**text**) and italic (*text*) where apparent in the original
- If the document contains forms, represent form fields as: **Field Name:** [value or blank]
- For checkboxes, use: - [x] checked or - [ ] unchecked
- If structure is ambiguous, prefer flat paragraphs over wrong headings
- Do not add any commentary, meta-text, or descriptions of the document
- Do not wrap the output in a code block

Document title for context: "${title}"`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(180_000), // 3 min for large scanned docs
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vision PDF extraction failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const markdown = data.content?.[0]?.text?.trim() ?? "";
  return { markdown, method: "llm_vision_pdf" };
}

/**
 * Spreadsheet → Markdown tables (programmatic, no LLM).
 */
function spreadsheetToMarkdown(buffer: ArrayBuffer): { markdown: string; method: string } {
  const wb = XLSX.read(Buffer.from(buffer), { type: "buffer" });
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    if (!json.length) continue;

    // Find the first non-empty row as header
    let headerIdx = 0;
    while (headerIdx < json.length && (!json[headerIdx] || json[headerIdx]!.every((c) => c === null || c === undefined || c === ""))) {
      headerIdx++;
    }
    if (headerIdx >= json.length) continue;

    const headers = json[headerIdx]!.map((h) => String(h ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "));
    const colCount = headers.length;
    if (colCount === 0) continue;

    const separator = headers.map(() => "---");
    const dataRows = json.slice(headerIdx + 1).filter((row) => row && row.some((c) => c !== null && c !== undefined && c !== ""));

    const rows = dataRows.map((row) => {
      const cells: string[] = [];
      for (let i = 0; i < colCount; i++) {
        cells.push(String(row[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "));
      }
      return `| ${cells.join(" | ")} |`;
    });

    sheets.push(
      `## Sheet: ${name}\n\n| ${headers.join(" | ")} |\n| ${separator.join(" | ")} |\n${rows.join("\n")}`
    );
  }

  return { markdown: sheets.join("\n\n---\n\n") || "", method: "xlsx_programmatic" };
}

// ---------------------------------------------------------------------------
// LLM helper: text → Markdown (for text-based PDFs and plain text)
// ---------------------------------------------------------------------------
async function llmTextToMarkdown(text: string, title: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MD_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Convert this extracted document text into clean, well-structured Markdown.

Rules:
- Preserve ALL content verbatim — do not summarize, rephrase, or omit anything
- Detect and apply heading levels (# ## ###) based on the document structure
- Convert any tabular data into Markdown tables with proper headers and alignment
- Preserve bullet/numbered lists with correct nesting
- Mark bold (**text**) and italic (*text*) where apparent
- If the document contains forms, represent form fields as: **Field Name:** [value or blank]
- For checkboxes, use: - [x] checked or - [ ] unchecked
- If structure is ambiguous, prefer flat paragraphs over wrong headings
- Do not add any commentary, meta-text, or descriptions of the document
- Do not wrap the output in a code block

Document title: "${title}"

---
${text}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    // Fallback: return raw text if LLM fails (still better than nothing)
    console.error(`LLM markdown conversion failed (${res.status}), falling back to raw text`);
    return text;
  }
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? text;
}

function splitTextForBatching(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  // Try to split on page-break patterns first
  const pageBreaks = text.split(/\f|\n{4,}|(?=\n[A-Z][A-Z\s:]{10,}\n)/);

  let current = "";
  for (const segment of pageBreaks) {
    if (current.length + segment.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      // Keep last 200 chars as overlap for context continuity
      current = current.slice(-200) + segment;
    } else {
      current += segment;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If no natural breaks were found, force-split
  if (chunks.length <= 1 && text.length > maxChars) {
    const forced: string[] = [];
    for (let i = 0; i < text.length; i += maxChars - 200) {
      forced.push(text.slice(i, i + maxChars));
    }
    return forced;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Master conversion dispatcher
// ---------------------------------------------------------------------------
async function convertToMarkdown(
  buffer: ArrayBuffer,
  kind: FileKind,
  title: string,
  rawText: string,
): Promise<{ markdown: string; rawText: string; method: string }> {
  switch (kind) {
    case "docx": {
      const { markdown, method } = await docxToMarkdown(buffer);
      // rawText from mammoth extractRawText is still useful for FTS
      return { markdown, rawText, method };
    }
    case "pdf": {
      if (isScannedPdf(rawText)) {
        // Scanned PDF: use Claude vision on the PDF bytes directly
        const { markdown, method } = await scannedPdfToMarkdown(buffer, title);
        // For scanned PDFs, the markdown IS the raw text (no text was extractable)
        const effectiveRawText = rawText.trim().length < SCANNED_PDF_MIN_CHARS ? markdown : rawText;
        return { markdown, rawText: effectiveRawText, method };
      }
      // Text-based PDF: structure the extracted text into Markdown via LLM
      const { markdown, method } = await textPdfToMarkdown(rawText, title);
      return { markdown, rawText, method };
    }
    case "spreadsheet": {
      const { markdown, method } = spreadsheetToMarkdown(buffer);
      return { markdown, rawText, method };
    }
    case "markdown": {
      // Already Markdown — pass through, use as both raw and markdown
      const text = new TextDecoder().decode(buffer);
      return { markdown: text, rawText: text, method: "passthrough_md" };
    }
    case "text":
    default: {
      const text = new TextDecoder().decode(buffer);
      // For plain text > 500 chars, try LLM structuring; otherwise pass through
      if (text.trim().length > 500) {
        const md = await llmTextToMarkdown(text, title);
        return { markdown: md, rawText: text, method: "llm_text_to_md" };
      }
      return { markdown: text, rawText: text, method: "passthrough_text" };
    }
  }
}

// ---------------------------------------------------------------------------
// Semantic chunking (operates on Markdown input)
// ---------------------------------------------------------------------------
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

function semanticChunk(markdown: string): ChunkResult[] {
  const sections: ChunkResult[] = [];
  const paragraphs: ChunkResult[] = [];

  // Split on double-newlines but preserve Markdown tables and lists as units
  const blocks = splitMarkdownBlocks(markdown);

  let currentSection = "";
  let currentSectionTitle: string | null = null;
  let currentSectionTokens = 0;

  for (const block of blocks) {
    const blockTokens = estimateTokens(block);
    const isHeading = /^#{1,3}\s/.test(block);

    if (isHeading) {
      // Flush current section
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
      currentSectionTitle = block.replace(/^#+\s*/, "").trim();
      currentSection = block + "\n\n";
      currentSectionTokens = blockTokens;
      continue;
    }

    currentSection += block + "\n\n";
    currentSectionTokens += blockTokens;

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

  // Sub-chunk sections into paragraph-level chunks
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    const sectionBlocks = splitMarkdownBlocks(section.content);
    let buf = "";
    let bufferTokens = 0;

    for (const b of sectionBlocks) {
      const bTokens = estimateTokens(b);

      // Never split a Markdown table or list across chunks
      const isAtomicBlock = b.startsWith("|") || /^[-*+]\s/.test(b) || /^\d+\.\s/.test(b);

      if (bufferTokens + bTokens > CHUNK_TARGET_TOKENS && buf.trim() && !isAtomicBlock) {
        paragraphs.push({
          content: buf.trim(),
          tokenCount: bufferTokens,
          type: "paragraph",
          sectionTitle: section.sectionTitle,
          pageNumber: null,
          parentIndex: si,
        });
        const overlapChars = CHUNK_OVERLAP_TOKENS * 4;
        buf = buf.slice(-overlapChars) + "\n\n" + b;
        bufferTokens = estimateTokens(buf);
      } else {
        buf += (buf ? "\n\n" : "") + b;
        bufferTokens += bTokens;
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

/**
 * Split Markdown into blocks, keeping tables and multi-line list items intact.
 */
function splitMarkdownBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current = "";
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table boundaries
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable && current.trim()) {
        blocks.push(current.trim());
        current = "";
      }
      inTable = true;
      current += (current ? "\n" : "") + line;
      continue;
    }

    if (inTable) {
      // End of table
      blocks.push(current.trim());
      current = "";
      inTable = false;
    }

    // Empty line = block boundary (unless in table)
    if (trimmed === "") {
      if (current.trim()) {
        blocks.push(current.trim());
        current = "";
      }
      continue;
    }

    current += (current ? "\n" : "") + line;
  }

  if (current.trim()) {
    blocks.push(current.trim());
  }

  return blocks.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 20;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------
async function generateSummary(text: string, title: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MD_MODEL,
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

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Ingest pipeline (chunk → embed → store → summarize)
// ---------------------------------------------------------------------------
async function ingestDocument(
  admin: AdminClient,
  documentId: string,
  markdownText: string,
  rawText: string,
  title: string,
  workspaceId: string,
): Promise<number> {
  // Chunk the MARKDOWN, not raw text
  const chunks = semanticChunk(markdownText);
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));
  const sectionChunks = chunks.filter((c) => c.type === "section");
  const paraChunks = chunks.filter((c) => c.type === "paragraph");

  // Clear existing chunks for re-index
  await admin.from("chunks").delete().eq("document_id", documentId);

  const sectionRows = sectionChunks.map((chunk, i) => ({
    document_id: documentId,
    workspace_id: workspaceId,
    chunk_index: i,
    content: chunk.content,
    content_stripped: chunk.content.replace(/[#*_~`>|\-\[\]]/g, "").replace(/\s+/g, " ").trim(),
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
    content_stripped: chunk.content.replace(/[#*_~`>|\-\[\]]/g, "").replace(/\s+/g, " ").trim(),
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

  // Summarize from markdown (better quality than raw text)
  const summary = await generateSummary(markdownText, title);
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

async function finalizeUploadedDocument(
  admin: AdminClient,
  params: {
    userId: string;
    workspaceId: string;
    documentId: string;
    title: string;
    kind: FileKind;
    fileSize: number;
    markdown: string;
    rawText: string;
    conversionMethod: string;
  },
  t: ReturnType<typeof withTiming>,
) {
  const { userId, workspaceId, documentId, title, kind, fileSize, markdown, rawText, conversionMethod } = params;

  let chunkCount = 0;
  try {
    chunkCount = await ingestDocument(admin, documentId, markdown, rawText, title, workspaceId);
  } catch (ingestErr: unknown) {
    const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
    await admin.from("documents").update({ status: "ingest_failed" }).eq("id", documentId);
    await admin.from("document_audit_events").insert({
      actor_user_id: userId,
      document_id: documentId,
      document_title_snapshot: title,
      event_type: "ingest_failed",
      metadata: { error: msg },
    });
    t.log({ event: "ingest_failed", outcome: "error", document_id: documentId, error_message: msg });
    return;
  }

  await admin.from("document_audit_events").insert({
    actor_user_id: userId,
    document_id: documentId,
    document_title_snapshot: title,
    event_type: "uploaded",
    metadata: {
      chunk_count: chunkCount,
      file_type: kind,
      file_size: fileSize,
      conversion_method: conversionMethod,
      background: true,
    },
  });

  await admin.from("kb_analytics_events").insert({
    workspace_id: workspaceId,
    event_type: "doc_uploaded",
    user_id: userId,
    document_id: documentId,
    metadata: { chunk_count: chunkCount, conversion_method: conversionMethod, background: true },
  });

  t.log({
    event: "upload_ok",
    outcome: "success",
    document_id: documentId,
    chunks: chunkCount,
    conversion_method: conversionMethod,
    background: true,
  });
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
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

  // Auth
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
    // -----------------------------------------------------------------------
    // PATH 1: JSON — re-index or regenerate_markdown
    // -----------------------------------------------------------------------
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { document_id?: string; action?: string };
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

      // ACTION: regenerate_markdown — re-download from storage, re-convert, re-ingest
      if (body.action === "regenerate_markdown") {
        const meta = doc.metadata as { storage_path?: string; storage_bucket?: string; upload_kind?: string; original_filename?: string } | null;
        if (!meta?.storage_path) {
          return jsonResponse({ error: "No storage file to regenerate from" }, 400, origin);
        }

        const { data: fileData, error: dlErr } = await admin.storage
          .from(meta.storage_bucket || "documents")
          .download(meta.storage_path);
        if (dlErr || !fileData) {
          return jsonResponse({ error: `Storage download failed: ${dlErr?.message}` }, 500, origin);
        }

        const buffer = await fileData.arrayBuffer();
        const kind = (meta.upload_kind as FileKind) || "text";
        const rawText = await extractRawText(buffer, kind);
        const { markdown, method } = await convertToMarkdown(buffer, kind, doc.title, rawText);

        if (!markdown.trim()) {
          return jsonResponse({ error: "Markdown conversion produced empty result" }, 400, origin);
        }

        // Update document with new markdown
        await admin.from("documents").update({
          raw_text: rawText || doc.raw_text,
          markdown_text: markdown,
          conversion_method: method,
          updated_at: new Date().toISOString(),
        }).eq("id", document_id);

        // Re-ingest with new markdown
        const chunkCount = await ingestDocument(admin, doc.id, markdown, rawText || doc.raw_text, doc.title, doc.workspace_id);

        await admin.from("document_audit_events").insert({
          actor_user_id: user.id,
          document_id: doc.id,
          document_title_snapshot: doc.title,
          event_type: "markdown_regenerated",
          metadata: { chunk_count: chunkCount, conversion_method: method },
        });

        t.log({ event: "regenerate_md_ok", outcome: "success", document_id: doc.id, chunks: chunkCount, method });
        return new Response(JSON.stringify({
          success: true, document_id: doc.id, chunks: chunkCount, conversion_method: method,
        }), {
          headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      // DEFAULT ACTION: re-index from stored markdown_text (or fall back to raw_text)
      const textForChunking = doc.markdown_text || doc.raw_text;
      if (!textForChunking) {
        return jsonResponse({ error: "No text to re-index (no markdown_text or raw_text)" }, 400, origin);
      }

      const chunkCount = await ingestDocument(admin, doc.id, textForChunking, doc.raw_text || textForChunking, doc.title, doc.workspace_id);

      await admin.from("document_audit_events").insert({
        actor_user_id: user.id,
        document_id: doc.id,
        document_title_snapshot: doc.title,
        event_type: "reindexed",
        metadata: { chunk_count: chunkCount, source: doc.markdown_text ? "markdown_text" : "raw_text" },
      });

      t.log({ event: "reindex_ok", outcome: "success", document_id: doc.id, chunks: chunkCount });
      return new Response(JSON.stringify({ success: true, document_id: doc.id, chunks: chunkCount }), {
        headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // -----------------------------------------------------------------------
    // PATH 2: Multipart — new file upload
    // -----------------------------------------------------------------------
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

      // Step 1: Extract raw text (for FTS fallback)
      const rawTextPre = await extractRawText(fileBuffer, kind);

      // Step 2: Convert to Markdown IR
      let markdown: string;
      let conversionMethod: string;
      let rawText = rawTextPre;
      try {
        const result = await convertToMarkdown(fileBuffer, kind, title, rawTextPre);
        markdown = result.markdown;
        conversionMethod = result.method;
        // Update rawText if scanned PDF provided better text
        rawText = result.rawText;
      } catch (convErr: unknown) {
        // If Markdown conversion fails, fall back to raw text
        const msg = convErr instanceof Error ? convErr.message : String(convErr);
        console.error(`Markdown conversion failed, falling back to raw text: ${msg}`);
        markdown = rawTextPre;
        rawText = rawTextPre;
        conversionMethod = "fallback_raw";
      }

      if (!markdown.trim() && !rawText.trim()) {
        return jsonResponse({ error: "No text extracted from file" }, 400, origin);
      }

      // If markdown is empty but raw text exists, use raw text as markdown
      if (!markdown.trim()) {
        markdown = rawText;
        conversionMethod = "fallback_raw";
      }

      // Step 3: Upload original file to storage
      const storagePath = `kb/${workspaceId}/${crypto.randomUUID()}-${file.name}`;
      const { error: storageErr } = await admin.storage
        .from("documents")
        .upload(storagePath, fileBuffer, { contentType: file.type });
      const storageOk = !storageErr;
      if (storageErr) {
        t.log({
          event: "storage_upload_failed",
          outcome: "error",
          error_message: storageErr.message,
        });
      }

      const metadata: Record<string, unknown> = {
        original_filename: file.name,
        upload_kind: kind,
      };
      if (storageOk) {
        metadata.storage_bucket = "documents";
        metadata.storage_path = storagePath;
      }

      // Step 4: Insert document record with both raw_text and markdown_text
      const { data: doc, error: docInsertErr } = await admin
        .from("documents")
        .insert({
          workspace_id: workspaceId,
          title,
          source: "manual_upload",
          mime_type: file.type,
          raw_text: rawText,
          markdown_text: markdown,
          conversion_method: conversionMethod,
          audience: gov.audience,
          status: gov.status,
          uploaded_by: user.id,
          metadata,
        })
        .select("id, workspace_id, title")
        .single();

      if (docInsertErr || !doc) {
        return jsonResponse({ error: `Insert failed: ${docInsertErr?.message}` }, 500, origin);
      }

      await admin.from("document_audit_events").insert({
        actor_user_id: user.id,
        document_id: doc.id,
        document_title_snapshot: doc.title,
        event_type: "upload_queued",
        metadata: {
          file_type: kind,
          file_size: file.size,
          conversion_method: conversionMethod,
          storage_ok: storageOk,
        },
      });

      const backgroundTask = finalizeUploadedDocument(
        admin,
        {
          userId: user.id,
          workspaceId: doc.workspace_id,
          documentId: doc.id,
          title: doc.title,
          kind,
          fileSize: file.size,
          markdown,
          rawText,
          conversionMethod,
        },
        t,
      );
      const queued = queueBackgroundTask(backgroundTask);
      if (!queued) {
        await backgroundTask;
      }

      t.log({
        event: "upload_queued",
        outcome: "success",
        document_id: doc.id,
        conversion_method: conversionMethod,
        background: queued,
      });
      return new Response(
        JSON.stringify({
          success: true,
          queued,
          document_id: doc.id,
          title: doc.title,
          status: gov.status,
          audience: gov.audience,
          conversion_method: conversionMethod,
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
