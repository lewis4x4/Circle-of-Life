/**
 * Diagnoses as recorded.
 *
 * `residents.primary_diagnosis` is free text and, for imported residents, often
 * the whole diagnosis list joined with commas ("Osteopenia, Gerd, Colon Polyps,
 * …"). `residents.diagnosis_list` holds the same conditions one per entry. Shown
 * naively, the combined string appears as one more (misleading) diagnosis beside
 * the individual ones. This module reads both fields, splits a combined primary
 * string into its parts for de-duplication, and keeps the combined text visible
 * as the primary field's entry so nothing recorded is hidden. It never rewrites
 * the source record and never regroups conditions into invented categories.
 */

import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";

const LIST_SEPARATOR = /\s*[;,]\s*/;

export type RecordedDiagnoses = {
  /** De-duplicated conditions in recorded order, display-cased. */
  conditions: string[];
  /**
   * The primary diagnosis as a single condition, when the field holds one.
   * Null when the field is empty or is a combined list.
   */
  primary: string | null;
  /**
   * The primary diagnosis field verbatim when it holds several conditions in
   * one string, so the operator can see it was entered as one combined value.
   */
  combinedPrimaryAsEntered: string | null;
};

function normalizeKey(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ").toLowerCase();
}

function isCombined(phrase: string): boolean {
  return phrase.split(LIST_SEPARATOR).filter((part) => part.trim().length > 0).length > 1;
}

export function recordedDiagnoses(
  primaryDiagnosis: string | null | undefined,
  diagnosisList: readonly string[] | null | undefined,
): RecordedDiagnoses {
  const primaryRaw = (primaryDiagnosis ?? "").trim().replace(/\s+/g, " ");
  const listRaw = (diagnosisList ?? []).map((entry) => (entry ?? "").trim()).filter(Boolean);

  const combined = primaryRaw.length > 0 && isCombined(primaryRaw);
  const primaryParts = combined
    ? primaryRaw.split(LIST_SEPARATOR).map((part) => part.trim()).filter(Boolean)
    : primaryRaw
      ? [primaryRaw]
      : [];

  const seen = new Set<string>();
  const conditions: string[] = [];
  for (const phrase of [...primaryParts, ...listRaw]) {
    const key = normalizeKey(phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    conditions.push(diagnosisDisplayTitle(phrase));
  }

  return {
    conditions,
    primary: !combined && primaryRaw ? diagnosisDisplayTitle(primaryRaw) : null,
    combinedPrimaryAsEntered: combined ? primaryRaw : null,
  };
}
