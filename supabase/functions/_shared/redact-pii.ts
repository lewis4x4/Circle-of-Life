export function redactString(input: string): string {
  return input
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/\b(?:medicare|medicaid|member|policy|mrn|medical record)\s*(?:id|number|#)?[:\s-]*[A-Z0-9-]{6,}\b/gi, "[REDACTED_MEMBER_ID]")
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, "[REDACTED_DOB]")
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/gi, "[REDACTED_DOB]")
    .replace(/\b\d+\s*(?:mg|mcg|g|ml|units?)\s*(?:\/\s*\w+)?(?:\s+(?:by mouth|po|im|iv|subq|topical))?(?:\s+\w+){0,6}\b/gi, "[REDACTED_DOSAGE]")
    .trim();
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
