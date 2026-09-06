/**
 * Design review: block user-facing schema / dev leaks in TSX.
 *
 * Catches patterns like TABLE.COLUMN in backticks, table.column hints tied to known
 * Postgres tables, snake_case table identifiers in backticks/code, and raw table
 * names surfaced in JSX/prose (excluding query API lines).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");

/** Full Postgres table identifiers (underscore form) forbidden in UX copy / code monospace. */
const KNOWN_UI_TABLE_IDENTIFIERS = [
  "discharge_med_reconciliation",
  "referral_hl7_inbound",
  "referral_leads",
] as const;

/** Also blocked in `<code>` / backticks — too noisy in prose due to FK property names (`row.referral_sources`). */
const CODE_BACKTICK_TABLE_EXTRA = ["referral_sources"] as const;

const KNOWN_PUBLIC_TABLE_PREFIXES = [
  "residents",
  "referral_leads",
  "referral_sources",
  "facilities",
  "organizations",
  "organization",
  "user_profiles",
  "audit_log",
  "invoices",
  "invoice_lines",
];

const TABLES_ALT = KNOWN_PUBLIC_TABLE_PREFIXES.join("|");

const CODE_ELEM_TABLE = /<code[^>]*>([^<]*)<\/code>/gi;

/** Non-global — avoid `.test()` lastIndex flakes across scanned lines. */
const FROM_CALL = /\.from\s*\(\s*["'`]/;

const lowercaseTableColumnBacktickRe = new RegExp(
  "`(" + TABLES_ALT + ")\\.([a-z][a-z0-9_]*)`",
  "gi",
);

const codeBacktickTableNames = [...KNOWN_UI_TABLE_IDENTIFIERS, ...CODE_BACKTICK_TABLE_EXTRA];

const backtickKnownTableRe = new RegExp("`(" + codeBacktickTableNames.join("|") + ")`", "gi");

function walkTsxFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsxFiles(full, out);
    } else if ((name.endsWith(".tsx") || name.endsWith(".jsx")) && !/\.(test|spec)\.[jt]sx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function lineLooksLikeDataAccess(line: string): boolean {
  const t = line.trimStart();
  if (FROM_CALL.test(line)) return true;
  if (/\.(select|insert|update|upsert|delete)\s*\(/i.test(line)) return true;
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  if (/type\s+\w+\s*=\s*Database/i.test(line)) return true;
  /** Supabase typed row selects / relational joins — not prose. */
  if (/\[["']referral_leads["']\]/.test(line)) return true;
  if (/\breferral_leads\s*:/.test(line)) return true;
  if (/\w+\.referral_leads\b/.test(line)) return true;
  /** PostgREST relationship embed snippets in `.select(...)`. */
  if (/\breferral_sources\s*\(/.test(line)) return true;
  /** Supabase generated table accessors / join selects — never UI prose. */
  if (/\[["']Tables["']\]\[["'][a-z0-9_]+["']\]/i.test(line)) return true;
  /** Typical embedded relation fields on typed rows/joins — not headings. */
  if (/\breferral_sources\s*:\s*\{/.test(line)) return true;
  if (/\breferral_leads\s*:\s*/.test(line) && /\.Row|Pick<|\bpartial\b/i.test(line)) return true;
  /** Supabase typed `Database` table accessors — not UI copy. */
  if (
    /\bDatabase\s*\[\s*[^\]]+\]\s*\[\s*["']Tables["']\s*\]\s*\[\s*["'](?:discharge_med_reconciliation|referral_leads|referral_sources|referral_hl7_inbound)["']\s*\]/.test(
      line,
    )
  ) {
    return true;
  }
  return false;
}

function scanFile(filePath: string): string[] {
  const rel = path.relative(root, filePath);
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const hits: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i]!;
    if (lineLooksLikeDataAccess(line)) continue;

    for (const m of line.matchAll(/`([A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*)`/g)) {
      hits.push(`${rel}:${lineNum}: Backtick uppercase schema token ${m[1]}`);
    }

    for (const m of line.matchAll(lowercaseTableColumnBacktickRe)) {
      hits.push(`${rel}:${lineNum}: Backtick known table.column ${m[1]}.${m[2]}`);
    }

    backtickKnownTableRe.lastIndex = 0;
    for (const m of line.matchAll(backtickKnownTableRe)) {
      hits.push(`${rel}:${lineNum}: Backtick exposes table name (${m[1]})`);
    }

    CODE_ELEM_TABLE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CODE_ELEM_TABLE.exec(line)) !== null) {
      const inner = m[1]!.trim();
      if (/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/.test(inner)) {
        hits.push(`${rel}:${lineNum}: <code> contains uppercase TABLE.COLUMN (${inner})`);
      }
      const dotMatch = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(inner);
      if (dotMatch && KNOWN_PUBLIC_TABLE_PREFIXES.includes(dotMatch[1]!)) {
        hits.push(`${rel}:${lineNum}: <code> contains known table.column (${inner})`);
      }
      if ((codeBacktickTableNames as readonly string[]).includes(inner)) {
        hits.push(`${rel}:${lineNum}: <code> exposes raw table name (${inner})`);
      }
    }

    const lineSansCodeBlocks = line.replace(/<code[^>]*>[^<]*<\/code>/gi, "");
    for (const table of KNOWN_UI_TABLE_IDENTIFIERS) {
      const re = new RegExp(`\\b${table}\\b`);
      if (!re.test(lineSansCodeBlocks)) continue;
      hits.push(`${rel}:${lineNum}: User-facing prose mentions ${table}`);
    }

    /** residents.referral_source_id prose (no backticks). */
    if (/\bresidents\.referral_source_id\b/i.test(line) && !lineLooksLikeDataAccess(line)) {
      hits.push(`${rel}:${lineNum}: Residents referral source column leaked in prose`);
    }
  }

  return hits;
}

function main() {
  const srcDir = path.join(root, "src");
  const files = walkTsxFiles(srcDir);
  const all: string[] = [];
  for (const f of files) {
    all.push(...scanFile(f));
  }

  const unique = [...new Set(all)].sort();
  if (unique.length > 0) {
    console.error("[no-schema-leak] FAIL:\n", unique.join("\n"));
    process.exit(1);
  }
  console.log("[no-schema-leak] PASS: no schema leaks flagged in TSX/JSX under src/");
  process.exit(0);
}

main();
