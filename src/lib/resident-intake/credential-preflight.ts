const FILE_NAME_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["credential_filename", /(?:^|[\s._-])(credential|credentials|login|passwords?)(?:[\s._-]|$)/i],
  ["network_secret_filename", /(?:^|[\s._-])(wifi|wi-fi|wireless|router|network)[\s._-]*(password|key|login|credentials?)(?:[\s._-]|$)/i],
  ["api_secret_filename", /(?:^|[\s._-])(api|access|private|secret)[\s._-]*(key|token|secret)(?:[\s._-]|$)/i],
];

const TEXT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["wifi_qr_payload", /(?:^|\s)WIFI:[^;\r\n]{0,200};/i],
  ["private_key_material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["cloud_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["authorization_bearer", /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  ["credential_assignment", /["']?\b(?:password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\b["']?\s*[:=]\s*["']?\S{4,}/i],
  ["full_sensitive_identifier", /\b\d{3}-\d{2}-\d{4}\b/],
];

export type CredentialPreflightInput = {
  fileName: string;
  mime: string;
  locallyInspectedText?: string | null;
  localInspectionTrustworthy?: boolean;
  humanClearanceRecorded?: boolean;
};

export type CredentialPreflightResult =
  | { disposition: "quarantine"; patternCodes: string[] }
  | { disposition: "human_clearance_required"; patternCodes: [] }
  | { disposition: "allowed"; patternCodes: [] };

/**
 * Pre-dispatch screening returns pattern identifiers only. It deliberately
 * never returns the matching substring, OCR text, or a credential candidate.
 * Images and PDFs are not claimed to have been inspected unless a trusted
 * local extractor explicitly says so; otherwise a human preview clearance is
 * mandatory.
 */
export function credentialPreflight(input: CredentialPreflightInput): CredentialPreflightResult {
  const codes = new Set<string>();
  for (const [code, pattern] of FILE_NAME_PATTERNS) {
    if (pattern.test(input.fileName)) codes.add(code);
  }
  if (input.localInspectionTrustworthy && input.locallyInspectedText) {
    for (const [code, pattern] of TEXT_PATTERNS) {
      if (pattern.test(input.locallyInspectedText)) codes.add(code);
    }
  }
  if (codes.size > 0) return { disposition: "quarantine", patternCodes: [...codes].sort() };
  if (!input.localInspectionTrustworthy && !input.humanClearanceRecorded) {
    return { disposition: "human_clearance_required", patternCodes: [] };
  }
  return { disposition: "allowed", patternCodes: [] };
}
