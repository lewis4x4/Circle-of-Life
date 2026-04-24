import type { CopilotSuggestion } from "./types";

const REQUIRED_KEYS: Array<keyof CopilotSuggestion> = [
  "id",
  "title",
  "body",
  "recordId",
  "recordType",
  "facilityId",
  "generatedAt",
  "modelVersion",
  "citations",
];

export function filterCitedSuggestions(
  input: unknown[],
  log: (message: string, suggestion: unknown) => void = (message, suggestion) => {
    if (typeof console !== "undefined") {
      console.warn(`[copilot] ${message}`, suggestion);
    }
  },
): CopilotSuggestion[] {
  const result: CopilotSuggestion[] = [];
  for (const raw of input) {
    if (!isPlainObject(raw)) {
      log("dropped suggestion: not an object", raw);
      continue;
    }
    const missingKey = REQUIRED_KEYS.find((key) => !(key in raw));
    if (missingKey) {
      log(`dropped suggestion: missing ${String(missingKey)}`, raw);
      continue;
    }
    const citations = raw.citations;
    if (!Array.isArray(citations) || citations.length === 0) {
      log("dropped suggestion: missing citations", raw);
      continue;
    }
    const allCitationsValid = citations.every(
      (c) =>
        isPlainObject(c) &&
        typeof c.source === "string" &&
        typeof c.id === "string" &&
        typeof c.excerpt === "string",
    );
    if (!allCitationsValid) {
      log("dropped suggestion: malformed citation", raw);
      continue;
    }
    result.push(raw as unknown as CopilotSuggestion);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
