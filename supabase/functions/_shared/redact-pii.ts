export function redactString(input: string): string {
  return redactStringWithCounts(input).text;
}

/**
 * KB-NEXT-08: same redaction but returns per-pattern hit counts so callers
 * (ingest pipeline, audit log) can diagnose what was scrubbed without ever
 * surfacing the raw values. Counts are only present for patterns that
 * matched at least once.
 */
export function redactStringWithCounts(input: string): {
  text: string;
  patterns_hit: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  // Order matters: more specific patterns first.
  let text = input
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
      bump("ssn");
      return "[REDACTED_SSN]";
    })
    .replace(/\b[A-Z]{2}\d{7}\b/g, () => {
      bump("dea");
      return "[REDACTED_DEA]";
    })
    .replace(/\b(?:medicare|medicaid|member|policy|mrn|medical record)\s*(?:id|number|#)?[:\s-]*[A-Z0-9-]{6,}\b/gi, () => {
      bump("member_id");
      return "[REDACTED_MEMBER_ID]";
    })
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, () => {
      bump("dob");
      return "[REDACTED_DOB]";
    })
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/gi, () => {
      bump("dob");
      return "[REDACTED_DOB]";
    })
    .replace(/(?<![\d.])\d{10}(?![\d.])/g, () => {
      bump("npi");
      return "[REDACTED_NPI]";
    })
    .replace(/\b\d+\s*(?:mg|mcg|g|ml|units?)\s*(?:\/\s*\w+)?(?:\s+(?:by mouth|po|im|iv|subq|topical))?(?:\s+\w+){0,6}\b/gi, () => {
      bump("dosage");
      return "[REDACTED_DOSAGE]";
    });
  text = text.trim();
  return { text, patterns_hit: counts };
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, redactValue(nested)]),
    ) as T;
  }
  return value;
}
