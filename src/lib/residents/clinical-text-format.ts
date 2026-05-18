/** Title-case clinical prose while preserving common medical acronyms. */

const COMMON_ACRONYMS = new Set([
  "COPD",
  "GERD",
  "CHF",
  "CAD",
  "PAD",
  "DVT",
  "PE",
  "UTI",
  "CVA",
  "TIA",
  "MS",
  "ALS",
  "ADHD",
  "PTSD",
  "OCD",
  "OSA",
  "DM",
  "HTN",
  "HLD",
]);

function capitalizeFragment(fragment: string): string {
  if (!fragment) return fragment;
  if (COMMON_ACRONYMS.has(fragment.toUpperCase())) return fragment.toUpperCase();

  /**
   * Two–four letter all-caps tokens (facility-specific shorthand) stay uppercase.
   * Longer shouting strings become title case word-by-word.
   */
  if (/^[A-Z]{2,4}$/.test(fragment)) return fragment;

  const lower = fragment.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function capitalizeToken(token: string): string {
  const lead = token.match(/^[^A-Za-z0-9]+/)?.[0] ?? "";
  const trail = token.match(/[^A-Za-z0-9]+$/)?.[0] ?? "";
  const inner = token.slice(lead.length, trail.length ? -trail.length : undefined);
  if (!inner || /^\d/.test(inner)) return token;

  if (inner.includes("-")) {
    return `${lead}${inner.split("-").map(capitalizeFragment).join("-")}${trail}`;
  }

  const parts = inner.split("/").map(capitalizeFragment);
  return `${lead}${parts.join("/")}${trail}`;
}

/** Normalize diagnosis phrases (often yelled in CAPS upstream) without mangling COPD-class acronyms. */
export function diagnosisDisplayTitle(input: string | null | undefined): string {
  if (!input || !input.trim()) return "";

  const phrase = input.trim().replace(/\s+/g, " ");
  /* Split commas/semicolons but keep separators natural */
  return phrase
    .split(/\s*[;,]\s*/)
    .map((chunk) =>
      chunk
        .split(/\s+/)
        .map((tok) => capitalizeToken(tok))
        .join(" "),
    )
    .join("; ");
}

export type DxCategoryBucket =
  | "Cardiac"
  | "Mental health"
  | "Respiratory"
  | "GI"
  | "ENT"
  | "Musculoskeletal"
  | "Other";

const CARDIAC_KEYS = /\b(hypertension|blood\s+pressure|cad|heart|chf|atrial|afib|vascular|lipid)\b/i;
const MH_KEYS = /\b(depress|anxiety|bipolar|psych|dementia|cognitive|alzheimer|schizo|mental)\b/i;
const RESP_KEYS = /\b(asthma|copd|respiratory|pulmon|oxygen|hypox)\b/i;
const GI_KEYS = /\b(gerd|reflux|gast|colon|bowel|ibs|liver|hepat)\b/i;
const METAB_KEYS = /\b(diabet|renal|kidney|ckd)\b/i;
const ENT_KEYS = /\b(eye|vision|cataract|glaucoma|ear|hearing)\b/i;
const MSK_KEYS = /\b(arthritis|spine|back\s+pain|osteopor|muscle)\b/i;

export function categorizeSingleDiagnosis(text: string): DxCategoryBucket {
  const lower = text.toLowerCase();
  if (CARDIAC_KEYS.test(lower)) return "Cardiac";
  if (RESP_KEYS.test(lower)) return "Respiratory";
  if (MH_KEYS.test(lower)) return "Mental health";
  if (GI_KEYS.test(lower) || METAB_KEYS.test(lower)) return "GI";
  if (ENT_KEYS.test(lower)) return "ENT";
  if (MSK_KEYS.test(lower)) return "Musculoskeletal";
  return "Other";
}

export function groupDiagnosesByCategory(diagnoses: string[]): Partial<Record<DxCategoryBucket, string[]>> {
  const out: Partial<Record<DxCategoryBucket, string[]>> = {};
  const seen = new Set<string>();

  for (const raw of diagnoses) {
    const t = raw.trim();
    if (!t) continue;
    const titled = diagnosisDisplayTitle(t);
    const key = `${categorizeSingleDiagnosis(t)}::${titled}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cat = categorizeSingleDiagnosis(t);
    const bucket = out[cat] ?? [];
    bucket.push(titled);
    out[cat] = bucket;
  }
  return out;
}

export const DX_CATEGORY_RENDER_ORDER: DxCategoryBucket[] = [
  "Cardiac",
  "Mental health",
  "Respiratory",
  "GI",
  "ENT",
  "Musculoskeletal",
  "Other",
];
