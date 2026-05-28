/**
 * PHI redaction patterns — single source of truth for both the Node logger
 * (src/lib/observability/logger.ts) and the Deno edge function shim
 * (supabase/functions/_shared/redact-pii.ts).
 *
 * Must stay runtime-agnostic: no `node:` imports, no `process`, no `Buffer`,
 * no `import.meta`. Plain JS + the TS type system only.
 */

export type RedactCounts = Record<string, number>;

export interface RedactResult {
  text: string;
  patterns_hit: RedactCounts;
}

/**
 * Redact a string and return per-pattern hit counts.
 * Pattern order is significant — more specific patterns run first.
 */
export function redactStringWithCounts(input: string): RedactResult {
  const counts: RedactCounts = {};
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  let text = input
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
      bump("ssn");
      return "[REDACTED_SSN]";
    })
    .replace(/\b[A-Z]{2}\d{7}\b/g, () => {
      bump("dea");
      return "[REDACTED_DEA]";
    })
    .replace(
      /\b(?:medicare|medicaid|member|policy|mrn|medical record)\s*(?:id|number|#)?[:\s-]*[A-Z0-9-]{6,}\b/gi,
      () => {
        bump("member_id");
        return "[REDACTED_MEMBER_ID]";
      },
    )
    .replace(
      /\b(?:dob|date of birth|born)\b[:\s-]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
      () => {
        bump("dob");
        return "[REDACTED_DOB]";
      },
    )
    .replace(
      /\b(?:dob|date of birth|born)\b[:\s-]*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/gi,
      () => {
        bump("dob");
        return "[REDACTED_DOB]";
      },
    )
    .replace(/(?<![\d.])\d{10}(?![\d.])/g, () => {
      bump("npi");
      return "[REDACTED_NPI]";
    })
    .replace(
      /\b\d+\s*(?:mg|mcg|g|ml|units?)\s*(?:\/\s*\w+)?(?:\s+(?:by mouth|po|im|iv|subq|topical))?(?:\s+\w+){0,6}\b/gi,
      () => {
        bump("dosage");
        return "[REDACTED_DOSAGE]";
      },
    );
  text = text.trim();
  return { text, patterns_hit: counts };
}

export function redactString(input: string): string {
  return redactStringWithCounts(input).text;
}

/**
 * Deep-redact any value. Strings are redacted, arrays and plain objects are
 * recursed into; other primitives pass through untouched.
 *
 * Note: this DOES walk the whole object graph — pair with a key-whitelist or
 * a hand-built context object when logging.
 */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactValue(nested),
      ]),
    ) as T;
  }
  return value;
}

/**
 * Build a context object containing only the requested keys, with every value
 * deep-redacted. Use this for logger `extra` payloads — it is strictly safer
 * than `redactValue(context)` because unknown keys never even enter the log.
 */
export function pickRedacted<K extends string>(
  source: Record<string, unknown> | undefined,
  keys: readonly K[],
): Partial<Record<K, unknown>> {
  if (!source) return {};
  const out: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = redactValue(source[key]);
    }
  }
  return out;
}
