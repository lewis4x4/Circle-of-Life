import { createClient } from "@/lib/supabase/client";

/**
 * COL-627: every face sheet opened for printing is logged, before it renders.
 *
 * `public.record_resident_face_sheet_print` (migration 470) writes one
 * `audit_log` row — resident id, facility, person, time, never a name — and
 * refuses a caller who cannot read the resident. Resolves to the audit row id,
 * or throws; a throw means the page must render nothing.
 */
export async function recordResidentFaceSheetPrint(residentId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = (await supabase.rpc(
    "record_resident_face_sheet_print" as never,
    { p_resident_id: residentId } as never,
  )) as unknown as { data: unknown; error: { code?: string; message?: string } | null };
  if (error) throw Object.assign(new Error(error.message ?? "Face sheet print not recorded"), { code: error.code });
  if (typeof data !== "string" || data.length === 0) throw new Error("Face sheet print not recorded");
  return data;
}

export const FACE_SHEET_NOT_RECORDED =
  "This face sheet could not be logged, so it was not shown. Every face-sheet print is recorded. Try again.";
export const FACE_SHEET_UNAVAILABLE = "This resident could not be found, or is outside your facility access.";

/** Operator copy for a refused or failed print record. */
export function faceSheetPrintErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  return code === "42501" ? FACE_SHEET_UNAVAILABLE : FACE_SHEET_NOT_RECORDED;
}
