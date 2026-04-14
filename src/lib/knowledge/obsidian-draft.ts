import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OBSIDIAN_ACTIVE_VAULT_PATH = "/Users/brianlewis/Circle of Life/Circle of Life";
const DRAFTS_FOLDER = ["00 Inbox", "KB Drafts"];
const MAX_IMPORTED_MARKDOWN_CHARS = 120_000;

export type ObsidianDraftDocument = {
  id: string;
  title: string;
  markdown_text: string | null;
  raw_text: string | null;
  summary: string | null;
  mime_type: string | null;
  audience: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ObsidianDraftResult = {
  notePath: string;
  vaultPath: string;
  draftTitle: string;
  suggestedTargetFolder: string;
  docType: string;
  module: string;
  relatedLinks: string[];
  updated: boolean;
};

type DraftInference = {
  docType: string;
  module: string;
  suggestedTargetFolder: string;
  relatedLinks: string[];
  aliases: string[];
};

function activeVaultPath(): string {
  return process.env.OBSIDIAN_ACTIVE_VAULT_PATH?.trim() || DEFAULT_OBSIDIAN_ACTIVE_VAULT_PATH;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function sanitizeTitle(value: string): string {
  return value.replace(/[/:]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function inferDraft(document: ObsidianDraftDocument): DraftInference {
  const text = normalizeText(
    [document.title, document.summary ?? "", document.markdown_text ?? "", document.raw_text ?? ""]
      .join(" ")
      .slice(0, 20_000),
  );

  const has = (...needles: string[]) => needles.some((needle) => text.includes(needle));

  if (has("employee handbook", "staff handbook", "new hire packet")) {
    return {
      docType: "policy",
      module: "workforce",
      suggestedTargetFolder: "01 Doctrine/Policies",
      relatedLinks: [
        "Employee Handbook Policy",
        "New Hire Onboarding Playbook",
        "Baya Medication Training Tracking",
        "Grace Pack - Certifications Expiring",
        "Memory Map - Grace Control Plane",
      ],
      aliases: ["employee handbook", "staff handbook", "onboarding"],
    };
  }

  if (has("incident", "medication incident", "elopement incident", "safety report")) {
    return {
      docType: "sop",
      module: "incidents",
      suggestedTargetFolder: "01 Doctrine/SOPs",
      relatedLinks: [
        "Incident Reporting SOP",
        "Grace Pack - Open Incidents",
        "Grace Pack - Resident Attention",
        "Ontology Term - Clinical Attention Terms",
        "Survey Readiness Playbook",
      ],
      aliases: ["incident write-up", "safety report", "event report"],
    };
  }

  if (has("infection control", "outbreak", "isolation", "surveillance", "infection")) {
    return {
      docType: "policy",
      module: "infection_control",
      suggestedTargetFolder: "01 Doctrine/Policies",
      relatedLinks: [
        "Infection Control Policy and Procedure Manual",
        "Grace Pack - Resident Attention",
        "Grace Pack - Executive Alerts",
        "Emergency Preparedness SOP",
      ],
      aliases: ["infection control", "outbreak policy"],
    };
  }

  if (has("transport", "ride request", "appointment request", "mileage")) {
    return {
      docType: "sop",
      module: "transportation",
      suggestedTargetFolder: "01 Doctrine/SOPs",
      relatedLinks: [
        "Transportation Scheduling SOP",
        "Grace Pack - Transport Trips",
        "Grande Cypress Override - Transportation Scheduling Window",
        "Memory Map - Grace Control Plane",
      ],
      aliases: ["transport request", "ride scheduling", "trip scheduling"],
    };
  }

  if (has("storm", "generator", "weather", "evacuation", "emergency preparedness")) {
    return {
      docType: "sop",
      module: "emergency_preparedness",
      suggestedTargetFolder: "01 Doctrine/SOPs",
      relatedLinks: [
        "Emergency Preparedness SOP",
        "Survey Readiness Playbook",
        "Grace Pack - Executive Alerts",
        "Rising Oaks Override - Generator and Weather Readiness",
        "Homewood Lodge Override - Emergency Vendor Contacts",
      ],
      aliases: ["storm prep", "generator readiness", "weather readiness"],
    };
  }

  if (has("review", "google", "yelp", "reputation")) {
    return {
      docType: "playbook",
      module: "reputation",
      suggestedTargetFolder: "01 Doctrine/Playbooks",
      relatedLinks: [
        "Google Review Reply Playbook",
        "Grace Pack - Unreplied Reviews",
        "Family Communication SOP",
      ],
      aliases: ["review replies", "reputation workflow"],
    };
  }

  if (has("insurance", "claim", "renewal", "coverage")) {
    return {
      docType: "sop",
      module: "insurance",
      suggestedTargetFolder: "01 Doctrine/SOPs",
      relatedLinks: [
        "Insurance Renewal Workflow",
        "Grace Pack - Open Claims",
        "Grace Pack - Executive Alerts",
      ],
      aliases: ["claims workflow", "renewals", "coverage review"],
    };
  }

  if (has("invoice", "accounts receivable", "statement of account", "collections")) {
    return {
      docType: "sop",
      module: "billing",
      suggestedTargetFolder: "01 Doctrine/SOPs",
      relatedLinks: [
        "Collections Follow-Up Procedure",
        "Grace Pack - AR Watchlist",
        "Employee Handbook Policy",
      ],
      aliases: ["ar", "collections", "overdue invoices"],
    };
  }

  if (has("tour", "referral", "inquiry", "admission", "move-in", "1823")) {
    return {
      docType: "playbook",
      module: "referrals",
      suggestedTargetFolder: "01 Doctrine/Playbooks",
      relatedLinks: [
        "Ontology Term - Admissions and Referral Terms",
        "Grace Pack - New Leads",
        "Grace Pack - Pending Admissions",
        "Memory Map - Grace Control Plane",
      ],
      aliases: ["lead", "referral", "admission"],
    };
  }

  return {
    docType: "reference",
    module: "knowledge",
    suggestedTargetFolder: "04 Sources/Imported PDFs",
    relatedLinks: [
      "Memory Map - Grace Control Plane",
    ],
    aliases: [],
  };
}

function buildDraftFilename(document: ObsidianDraftDocument): string {
  const safeTitle = sanitizeTitle(document.title || "Untitled");
  return `${safeTitle} Draft - ${document.id.slice(0, 8)}.md`;
}

function frontmatterArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function buildDraftMarkdown(document: ObsidianDraftDocument, inference: DraftInference): string {
  const sourceDocuments = uniq([
    typeof document.metadata?.original_filename === "string" ? document.metadata.original_filename : "",
  ]);
  const importedMarkdown = (document.markdown_text || document.raw_text || "").trim();
  const truncated = importedMarkdown.length > MAX_IMPORTED_MARKDOWN_CHARS;
  const importedSection = truncated
    ? `${importedMarkdown.slice(0, MAX_IMPORTED_MARKDOWN_CHARS)}\n\n[TRUNCATED AFTER ${MAX_IMPORTED_MARKDOWN_CHARS.toLocaleString()} CHARACTERS FOR DRAFT REVIEW]`
    : importedMarkdown;
  const draftTitle = `${sanitizeTitle(document.title)} Draft`;

  return `---
title: ${draftTitle}
doc_type: ${inference.docType}
status: draft
organization: Circle of Life
facility_scope: all
facility_tags: []
entity_tags: []
module: ${inference.module}
roles: []
topics: []
aliases: ${frontmatterArray(inference.aliases)}
owner: brian_lewis
effective_date: null
review_date: null
source_of_truth: obsidian
grace_priority: medium
grace_answerable: true
trust_rank: 4
supersedes: []
superseded_by: null
source_documents: ${frontmatterArray(sourceDocuments)}
related_document_id: ${document.id}
related_document_status: ${document.status}
suggested_target_folder: ${inference.suggestedTargetFolder}
---

# Draft Intake

This draft was created from a Haven Knowledge Base upload and still needs human review before promotion to active doctrine.

# Source Record

- Haven document id: \`${document.id}\`
- Original title: ${document.title}
- MIME type: ${document.mime_type ?? "unknown"}
- Audience: ${document.audience}
- Current KB status: ${document.status}
- Uploaded/updated: ${document.updated_at}

# Suggested Links

${inference.relatedLinks.map((link) => `- [[${link}]]`).join("\n")}

# Draft Summary

${document.summary ?? "No summary is available yet. Review the imported content below and promote the doctrine manually."}

# Promotion Checklist

- confirm the correct note type
- confirm the correct long-term folder
- add facility scope if this is facility-specific
- trim duplicate or low-signal content
- add stronger wikilinks before promoting to \`active\`

# Imported Content

${importedSection || "_No extracted markdown_text or raw_text was available at draft creation time._"}
`;
}

export async function ensureActiveObsidianVault(): Promise<string> {
  const vaultPath = activeVaultPath();
  await access(vaultPath);
  await mkdir(path.join(vaultPath, ...DRAFTS_FOLDER), { recursive: true });
  return vaultPath;
}

export async function createObsidianDraftFromDocument(document: ObsidianDraftDocument): Promise<ObsidianDraftResult> {
  const vaultPath = await ensureActiveObsidianVault();
  const inference = inferDraft(document);
  const draftFilename = buildDraftFilename(document);
  const notePath = path.join(vaultPath, ...DRAFTS_FOLDER, draftFilename);
  const content = buildDraftMarkdown(document, inference);
  await writeFile(notePath, content, "utf8");

  return {
    notePath,
    vaultPath,
    draftTitle: `${sanitizeTitle(document.title)} Draft`,
    suggestedTargetFolder: inference.suggestedTargetFolder,
    docType: inference.docType,
    module: inference.module,
    relatedLinks: inference.relatedLinks,
    updated: true,
  };
}

export default {
  ensureActiveObsidianVault,
  createObsidianDraftFromDocument,
};
