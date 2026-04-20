export const REPORT_EXPORT_BUCKET = "report-exports";
export const EXECUTIVE_STANDUP_PACKET_RENDER_VERSION = 2;

export function executiveStandupPdfStoragePath(
  organizationId: string,
  weekOf: string,
  version: number,
): string {
  return `${organizationId}/executive-standup/${weekOf}/v${version}/render-${EXECUTIVE_STANDUP_PACKET_RENDER_VERSION}/board-packet.pdf`;
}

export function looksLikeStorageObjectPath(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/api/");
}
