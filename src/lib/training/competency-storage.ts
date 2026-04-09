import type { Json } from "@/types/database";

export const COMPETENCY_CERTIFICATE_BUCKET = "competency-certificates";

export type CompetencyAttachment = {
  storage_path: string;
  label: string;
};

/** Build Storage object path inside `competency-certificates` (no leading slash). */
export function competencyCertificateObjectPath(
  organizationId: string,
  facilityId: string,
  demonstrationId: string,
  originalFileName: string,
): string {
  const base = originalFileName.trim() || "certificate.pdf";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const withPdf = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
  return `${organizationId}/${facilityId}/${demonstrationId}/${withPdf}`;
}

/** Build Storage path for `staff_training_completions.attachment_path` (migration `117` RLS uses `tc` segment). */
export function trainingCompletionCertificatePath(
  organizationId: string,
  facilityId: string,
  completionId: string,
  originalFileName: string,
): string {
  const base = originalFileName.trim() || "certificate.pdf";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const withPdf = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
  return `${organizationId}/${facilityId}/tc/${completionId}/${withPdf}`;
}

export function parseCompetencyAttachments(raw: Json | null): CompetencyAttachment[] {
  if (raw == null || !Array.isArray(raw)) return [];
  const out: CompetencyAttachment[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const storage_path = rec.storage_path;
    if (typeof storage_path !== "string" || storage_path.length === 0) continue;
    const label = typeof rec.label === "string" && rec.label.length > 0 ? rec.label : "Certificate";
    out.push({ storage_path, label });
  }
  return out;
}
