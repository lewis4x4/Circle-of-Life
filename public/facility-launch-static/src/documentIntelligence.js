const ARTIFACT_RULES = [
  { artifactType: "state_license", group: "License", modules: ["M2", "M17"], patterns: [/license|licensure|state/i] },
  { artifactType: "gl_cert", group: "General Liability", modules: ["M17"], patterns: [/\bgl\b|general\s+liability|liability\s+cert|certificate\s+of\s+liability/i] },
  { artifactType: "property_policy", group: "Property Policy", modules: ["M17"], patterns: [/property.*policy|policy.*property/i] },
  { artifactType: "property_insurance", group: "Property Insurance", modules: ["M17"], patterns: [/evidence.*property|commercial\s+property|property\s+insurance/i] },
  { artifactType: "bond_certificate", group: "Bond Certificate", modules: ["M17"], patterns: [/bond/i] },
  { artifactType: "loss_run", group: "Loss Run", modules: ["M16", "M17"], patterns: [/loss\s*run|claims?\s+history|claim/i] },
  { artifactType: "floor_plan", group: "Floor Plan", modules: ["M3", "M17"], patterns: [/floor\s*plan|room\s*map|unit\s*map/i] },
  { artifactType: "emergency_plan", group: "Emergency Plan", modules: ["M16", "M18", "M17"], patterns: [/emergency|evacuation|disaster/i] },
  { artifactType: "vendor_agreement", group: "Vendor Agreement", modules: ["M18", "M17"], patterns: [/vendor|agreement|contract|service/i] }
];

const FACILITY_RULES = [
  { pattern: /homewood/i, facility: "Homewood Lodge ALF" },
  { pattern: /oakridge/i, facility: "Oakridge" },
  { pattern: /rising\s*oaks/i, facility: "Rising Oaks" },
  { pattern: /grand\s*cypress/i, facility: "Grand Cypress" },
  { pattern: /pinehouse/i, facility: "Pinehouse" }
];

function cleanBaseName(fileName = "") {
  return String(fileName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text = "") {
  return cleanBaseName(text).replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstYear(text = "") {
  const match = String(text).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function dateFor(year, month = 1, day = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currencyFromExpiration(expirationDate) {
  if (!expirationDate) return "unknown";
  const expiration = new Date(`${expirationDate}T23:59:59`);
  if (Number.isNaN(expiration.getTime())) return "unknown";
  const now = new Date();
  if (expiration < now) return "stale";
  const daysUntilExpiration = (expiration.getTime() - now.getTime()) / 86400000;
  return daysUntilExpiration <= 90 ? "aging" : "fresh";
}

function detectArtifact(fileName) {
  for (const rule of ARTIFACT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(fileName))) return rule;
  }
  return { artifactType: "other", group: "Other Document", modules: ["M17"], patterns: [] };
}

function detectFacility(fileName) {
  return FACILITY_RULES.find((rule) => rule.pattern.test(fileName))?.facility || "Homewood Lodge ALF";
}

function confidenceFor(rule, year) {
  if (rule.artifactType !== "other" && year) return "high";
  if (rule.artifactType !== "other") return "medium";
  return "low";
}

export function inferDocumentIntelligence(fileName = "", existing = {}) {
  const sourceName = String(fileName || existing.title || existing.originalFilename || "").trim();
  const baseTitle = cleanBaseName(existing.title || sourceName || "Uploaded document");
  const rule = detectArtifact(sourceName || baseTitle);
  const year = firstYear(sourceName || baseTitle);
  const facility = existing.entityAssociation || existing.facilityName || detectFacility(sourceName || baseTitle);
  const effectiveDate = existing.effectiveDate || (year ? dateFor(year) : "");
  const expirationDate = existing.expirationDate || (year && rule.artifactType !== "loss_run" ? dateFor(year + 1) : "");
  const term = existing.term || (year ? `${year} ${rule.group}` : rule.group);
  const currencyStatus = existing.currencyStatus || currencyFromExpiration(expirationDate);
  const confidence = existing.confidence || confidenceFor(rule, year);
  const documentGroupId = existing.documentGroupId || `grp-${rule.artifactType}-${facility.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${year || "unknown"}`;
  const groupName = existing.groupName || `${facility} ${year || "Current"} ${rule.group}`;
  const mappedModuleCodes = existing.mappedModuleCodes || rule.modules;

  return {
    title: existing.title || titleCase(baseTitle || sourceName),
    artifactType: existing.artifactType || rule.artifactType,
    entityAssociation: facility,
    facilityName: facility,
    term,
    effectiveDate,
    expirationDate,
    currencyStatus,
    version: existing.version || "v1",
    custodianApprovalStatus: existing.custodianApprovalStatus || "pending",
    confidence,
    documentGroupId,
    groupName,
    mappedModuleCodes,
    automationSummary: `Auto-classified as ${rule.group}; routed to ${mappedModuleCodes.join(", ")}; ${currencyStatus === "stale" ? "needs refreshed document or exception" : "ready for custodian review"}.`,
    notes: existing.notes || `Auto-detected from filename. ${year ? `Detected term year ${year}.` : "No year detected; confirm term/dates."}`
  };
}
