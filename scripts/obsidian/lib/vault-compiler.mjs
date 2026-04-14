import fs from "node:fs";
import path from "node:path";

export const DEFAULT_VAULT_PATH = "/Users/brianlewis/Circle of Life/COL-Knowledge-Vault";

export const CANONICAL_DOC_TYPES = new Set([
  "policy",
  "sop",
  "playbook",
  "facility_override",
  "decision_record",
  "ontology_term",
  "grace_pack",
  "role_guide",
  "source_document",
  "reference",
]);

export const CANONICAL_STATUSES = new Set([
  "draft",
  "review_pending",
  "active",
  "archived",
  "superseded",
]);

export const CANONICAL_GRACE_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

export const BASE_REQUIRED_KEYS = [
  "title",
  "doc_type",
  "status",
  "organization",
  "facility_scope",
  "facility_tags",
  "entity_tags",
  "module",
  "roles",
  "topics",
  "aliases",
  "owner",
  "source_of_truth",
  "grace_priority",
  "grace_answerable",
  "trust_rank",
  "supersedes",
  "superseded_by",
  "source_documents",
];

export const TYPE_REQUIRED_KEYS = {
  grace_pack: [
    "question_patterns",
    "preferred_live_tables",
    "preferred_doc_refs",
    "required_clarifications",
    "forbidden_substitutions",
    "answer_shape",
    "example_good_answers",
  ],
  facility_override: [
    "base_document_refs",
    "override_reason",
    "approved_by",
    "valid_from",
    "valid_until",
  ],
  decision_record: [
    "decision_date",
    "decision_owner",
    "rejected_options",
    "impact_domains",
  ],
  ontology_term: [
    "canonical_term",
    "alias_group",
    "maps_to_domains",
    "maps_to_tables",
    "do_not_confuse_with",
  ],
};

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [value].filter(Boolean);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function walkMarkdownFiles(root, acc = []) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) acc.push(fullPath);
  }
  return acc;
}

function parseScalar(rawValue) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null") return null;
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue);
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((part) => part.trim())
      .map((part) => part.replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return rawValue.replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return null;
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) return null;

  const fm = content.slice(4, endIndex).split("\n");
  const result = {};
  let currentKey = null;

  for (const rawLine of fm) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(parseScalar(listMatch[1].trim()));
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    currentKey = key;
    if (value === "") {
      result[key] = [];
      continue;
    }
    result[key] = parseScalar(value.trim());
  }

  return result;
}

function stripFrontmatter(content) {
  if (!content.startsWith("---\n")) return content;
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) return content;
  return content.slice(endIndex + 5);
}

function wordCount(text) {
  const parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function extractWikilinks(markdown) {
  const links = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(markdown))) {
    const target = match[1].split("|")[0].trim();
    if (target) links.push(target);
  }
  return links;
}

function inferChunkClass(docType, heading) {
  const headingText = normalizeText(heading);
  if (docType === "grace_pack") {
    if (headingText.includes("answer contract")) return "grace_contract";
    if (headingText.includes("clarify")) return "escalation_path";
    if (headingText.includes("forbidden")) return "exception_rule";
    if (headingText.includes("intent")) return "glossary_definition";
    return "grace_contract";
  }
  if (docType === "facility_override") {
    if (headingText.includes("local reality")) return "facility_override";
    if (headingText.includes("grace retrieval behavior")) return "exception_rule";
    return "facility_override";
  }
  if (docType === "decision_record") {
    return headingText.includes("why") || headingText.includes("rejected")
      ? "decision_rationale"
      : "policy_statement";
  }
  if (docType === "ontology_term") {
    return "glossary_definition";
  }
  if (headingText.includes("procedure")) return "procedure_step";
  if (headingText.includes("exception")) return "exception_rule";
  if (headingText.includes("escalation")) return "escalation_path";
  return "policy_statement";
}

function stripMarkdown(markdown) {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[#>*_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSections(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const sections = [];
  let currentHeading = "Overview";
  let buffer = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (!content) return;
    sections.push({ heading: currentHeading, content });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections.length > 0 ? sections : [{ heading: "Overview", content: markdown.trim() }];
}

function chunkSection(section, docMeta, maxChars = 1600) {
  const paragraphs = section.content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = [];
  let currentLength = 0;

  const flush = () => {
    const content = current.join("\n\n").trim();
    if (!content) return;
    chunks.push({
      heading: section.heading,
      content,
      contentStripped: stripMarkdown(content),
      chunkClass: inferChunkClass(docMeta.docType, section.heading),
    });
    current = [];
    currentLength = 0;
  };

  for (const paragraph of paragraphs) {
    if (currentLength > 0 && currentLength + paragraph.length > maxChars) {
      flush();
    }
    current.push(paragraph);
    currentLength += paragraph.length;
  }
  flush();

  if (chunks.length === 0) {
    chunks.push({
      heading: section.heading,
      content: section.content.trim(),
      contentStripped: stripMarkdown(section.content),
      chunkClass: inferChunkClass(docMeta.docType, section.heading),
    });
  }

  return chunks;
}

export function validateFile(filePath, vaultPath) {
  const relPath = path.relative(vaultPath, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  if (relPath === "README.md") return { relPath, skipped: true };

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return {
      relPath,
      errors: ["Missing or malformed frontmatter"],
      warnings: [],
      docType: null,
      frontmatter: null,
    };
  }

  const errors = [];
  const warnings = [];

  for (const key of BASE_REQUIRED_KEYS) {
    if (!(key in frontmatter)) errors.push(`Missing required frontmatter key: ${key}`);
  }

  const docType = typeof frontmatter.doc_type === "string" ? frontmatter.doc_type : null;
  if (docType && !CANONICAL_DOC_TYPES.has(docType)) {
    errors.push(`Invalid doc_type: ${docType}`);
  }

  const status = typeof frontmatter.status === "string" ? frontmatter.status : null;
  if (status && !CANONICAL_STATUSES.has(status)) {
    errors.push(`Invalid status: ${status}`);
  }

  const gracePriority = typeof frontmatter.grace_priority === "string" ? frontmatter.grace_priority : null;
  if (gracePriority && !CANONICAL_GRACE_PRIORITIES.has(gracePriority)) {
    errors.push(`Invalid grace_priority: ${gracePriority}`);
  }

  if (frontmatter.organization && frontmatter.organization !== "Circle of Life") {
    warnings.push(`Unexpected organization value: ${frontmatter.organization}`);
  }

  if (typeof frontmatter.trust_rank === "number") {
    if (frontmatter.trust_rank < 1 || frontmatter.trust_rank > 5) {
      errors.push(`trust_rank out of range: ${frontmatter.trust_rank}`);
    }
  }

  for (const arrayKey of [
    "facility_tags",
    "entity_tags",
    "roles",
    "topics",
    "aliases",
    "supersedes",
    "source_documents",
  ]) {
    if (arrayKey in frontmatter && !Array.isArray(frontmatter[arrayKey])) {
      errors.push(`${arrayKey} must be an array`);
    }
  }

  if (docType && TYPE_REQUIRED_KEYS[docType]) {
    for (const key of TYPE_REQUIRED_KEYS[docType]) {
      if (!(key in frontmatter)) errors.push(`Missing ${docType}-specific key: ${key}`);
    }
  }

  return {
    relPath,
    errors,
    warnings,
    docType,
    frontmatter,
  };
}

export function validateVault(vaultPath = DEFAULT_VAULT_PATH) {
  const files = walkMarkdownFiles(vaultPath);
  const results = files.map((filePath) => validateFile(filePath, vaultPath));
  const checked = results.filter((entry) => !entry.skipped);
  const failing = checked.filter((entry) => entry.errors.length > 0);

  const docTypeCounts = checked.reduce((acc, entry) => {
    if (!entry.docType) return acc;
    acc[entry.docType] = (acc[entry.docType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ok: failing.length === 0,
    vault_path: vaultPath,
    files_checked: checked.length,
    doc_type_counts: docTypeCounts,
    failing_files: failing,
    warnings: checked.flatMap((entry) => entry.warnings.map((warning) => ({ file: entry.relPath, warning }))),
    results,
  };
}

function buildPlanningHint(frontmatter, canonicalSlug) {
  if (frontmatter.doc_type !== "grace_pack") return null;
  const preferredLiveTables = ensureArray(frontmatter.preferred_live_tables);
  const normalizedTitle = normalizeText(frontmatter.title.replace(/^Grace Pack - /, ""));
  let routeBias = null;
  if (preferredLiveTables.length > 0) {
    if (normalizedTitle.includes("census")) routeBias = "census";
    else if (normalizedTitle.includes("resident attention")) routeBias = "resident_attention";
    else if (normalizedTitle.includes("new leads")) routeBias = "referral_pipeline";
    else if (normalizedTitle.includes("pending admissions")) routeBias = "admissions";
    else if (normalizedTitle.includes("open incidents")) routeBias = "incidents";
    else if (normalizedTitle.includes("med queue")) routeBias = "medications";
    else if (normalizedTitle.includes("certifications expiring")) routeBias = "training";
    else if (normalizedTitle.includes("transport trips")) routeBias = "transport";
    else if (normalizedTitle.includes("unreplied reviews")) routeBias = "reputation";
    else if (normalizedTitle.includes("ar watchlist")) routeBias = "finance";
    else if (normalizedTitle.includes("open claims")) routeBias = "insurance";
    else if (normalizedTitle.includes("executive alerts")) routeBias = "executive";
    else routeBias = slugify(frontmatter.title.replace(/^Grace Pack - /, "")).replace(/-/g, "_");
  }

  return {
    canonicalSlug,
    routeBias,
    clarificationPrompt: ensureArray(frontmatter.required_clarifications)[0] ?? null,
    forbiddenSubstitutions: ensureArray(frontmatter.forbidden_substitutions),
    preferredAnswerShape: frontmatter.answer_shape ?? null,
    preferredLiveTables,
    metadata: {
      question_patterns: ensureArray(frontmatter.question_patterns),
      preferred_doc_refs: ensureArray(frontmatter.preferred_doc_refs),
      example_good_answers: ensureArray(frontmatter.example_good_answers),
    },
  };
}

export function compileVault(vaultPath = DEFAULT_VAULT_PATH) {
  const validation = validateVault(vaultPath);
  if (!validation.ok) {
    const error = new Error("Vault validation failed");
    error.validation = validation;
    throw error;
  }

  const validEntries = validation.results.filter((entry) => !entry.skipped && entry.errors.length === 0);
  const docs = validEntries.map((entry) => {
    const relPath = entry.relPath;
    const fullPath = path.join(vaultPath, relPath);
    const content = fs.readFileSync(fullPath, "utf8");
    const frontmatter = entry.frontmatter;
    const body = stripFrontmatter(content).trim();
    const title = frontmatter.title;
    const canonicalSlug = slugify(frontmatter.canonical_slug ?? title ?? relPath.replace(/\.md$/, ""));
    const titleSlug = slugify(title);
    const sectionChunks = splitSections(body).flatMap((section) =>
      chunkSection(section, { docType: frontmatter.doc_type }),
    );
    const aliases = Array.from(
      new Set([
        title,
        ...ensureArray(frontmatter.aliases),
      ].map((value) => normalizeText(value)).filter(Boolean)),
    );
    const wikiLinks = extractWikilinks(body);
    return {
      relPath,
      title,
      titleSlug,
      canonicalSlug,
      docType: frontmatter.doc_type,
      frontmatter,
      body,
      wordCount: wordCount(stripMarkdown(body)),
      aliases,
      wikiLinks,
      chunks: sectionChunks.map((chunk, index) => ({
        chunkIndex: index,
        content: chunk.content,
        contentStripped: chunk.contentStripped,
        sectionTitle: chunk.heading,
        chunkType: frontmatter.doc_type,
        metadata: {
          chunk_class: chunk.chunkClass,
          source_heading: chunk.heading,
          doc_type: frontmatter.doc_type,
          canonical_slug: canonicalSlug,
          facility_scope: frontmatter.facility_scope,
          facility_tags: ensureArray(frontmatter.facility_tags),
          role_tags: ensureArray(frontmatter.roles),
          topic_tags: ensureArray(frontmatter.topics),
          trust_rank: frontmatter.trust_rank ?? null,
        },
      })),
      planningHint: buildPlanningHint(frontmatter, canonicalSlug),
    };
  });

  const docByTitle = new Map();
  const docBySlug = new Map();
  for (const doc of docs) {
    docByTitle.set(normalizeText(doc.title), doc);
    docBySlug.set(doc.canonicalSlug, doc);
  }

  const relationships = [];
  for (const doc of docs) {
    for (const supersedesTitle of ensureArray(doc.frontmatter.supersedes)) {
      const target = docByTitle.get(normalizeText(supersedesTitle)) ?? docBySlug.get(slugify(supersedesTitle));
      if (target) {
        relationships.push({
          fromSlug: doc.canonicalSlug,
          toSlug: target.canonicalSlug,
          relationshipType: "supersedes",
          metadata: { source: "frontmatter.supersedes" },
        });
      }
    }

    if (doc.frontmatter.superseded_by) {
      const target =
        docByTitle.get(normalizeText(doc.frontmatter.superseded_by)) ??
        docBySlug.get(slugify(doc.frontmatter.superseded_by));
      if (target) {
        relationships.push({
          fromSlug: target.canonicalSlug,
          toSlug: doc.canonicalSlug,
          relationshipType: "supersedes",
          metadata: { source: "frontmatter.superseded_by" },
        });
      }
    }

    for (const baseRef of ensureArray(doc.frontmatter.base_document_refs)) {
      const target = docByTitle.get(normalizeText(baseRef)) ?? docBySlug.get(slugify(baseRef));
      if (target) {
        relationships.push({
          fromSlug: doc.canonicalSlug,
          toSlug: target.canonicalSlug,
          relationshipType: "overrides",
          metadata: { source: "frontmatter.base_document_refs" },
        });
      }
    }

    for (const prefRef of ensureArray(doc.frontmatter.preferred_doc_refs)) {
      const target = docByTitle.get(normalizeText(prefRef)) ?? docBySlug.get(slugify(prefRef));
      if (target) {
        relationships.push({
          fromSlug: doc.canonicalSlug,
          toSlug: target.canonicalSlug,
          relationshipType: "supports_route",
          metadata: { source: "frontmatter.preferred_doc_refs" },
        });
      }
    }

    for (const linkTitle of doc.wikiLinks) {
      const target = docByTitle.get(normalizeText(linkTitle)) ?? docBySlug.get(slugify(linkTitle));
      if (target) {
        relationships.push({
          fromSlug: doc.canonicalSlug,
          toSlug: target.canonicalSlug,
          relationshipType: "supports_route",
          metadata: { source: "wikilink" },
        });
      }
    }
  }

  const contradictions = [];
  const activeDocs = docs.filter((doc) => doc.frontmatter.status === "active");

  const titleGroups = new Map();
  for (const doc of activeDocs) {
    const key = normalizeText(doc.title);
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(doc);
  }
  for (const docsForTitle of titleGroups.values()) {
    if (docsForTitle.length > 1) {
      contradictions.push({
        severity: "p0",
        contradictionType: "active_conflict",
        description: `Multiple active documents share the title "${docsForTitle[0].title}".`,
        leftSlug: docsForTitle[0].canonicalSlug,
        rightSlug: docsForTitle[1].canonicalSlug,
        metadata: { source: "duplicate_active_title" },
      });
    }
  }

  const aliasMap = new Map();
  for (const doc of activeDocs) {
    for (const alias of doc.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, []);
      aliasMap.get(alias).push(doc);
    }
  }
  for (const [alias, docsForAlias] of aliasMap.entries()) {
    const uniqueDocTypes = new Set(docsForAlias.map((doc) => doc.docType));
    if (docsForAlias.length > 1 && uniqueDocTypes.size > 1) {
      contradictions.push({
        severity: "p1",
        contradictionType: "alias_collision",
        description: `Alias "${alias}" points at multiple active document types.`,
        leftSlug: docsForAlias[0].canonicalSlug,
        rightSlug: docsForAlias[1].canonicalSlug,
        metadata: { alias, doc_types: Array.from(uniqueDocTypes) },
      });
    }
  }

  for (const doc of docs) {
    if (doc.frontmatter.status === "superseded" && !doc.frontmatter.superseded_by) {
      contradictions.push({
        severity: "p2",
        contradictionType: "supersession_gap",
        description: `${doc.title} is superseded but does not name a successor.`,
        leftSlug: doc.canonicalSlug,
        rightSlug: null,
        metadata: { source: "missing_superseded_by" },
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    vaultPath,
    summary: {
      documents: docs.length,
      chunks: docs.reduce((sum, doc) => sum + doc.chunks.length, 0),
      aliases: docs.reduce((sum, doc) => sum + doc.aliases.length, 0),
      relationships: relationships.length,
      contradictions: contradictions.length,
    },
    validation,
    documents: docs,
    relationships,
    contradictions,
  };
}
