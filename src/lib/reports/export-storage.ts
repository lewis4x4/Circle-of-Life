export const REPORT_EXPORT_BUCKET = "report-exports";
export const EXECUTIVE_STANDUP_PACKET_RENDER_VERSION = 3;
export const RISK_SURVEY_BUNDLE_RENDER_VERSION = 1;
export const EXECUTIVE_LEAGUE_RENDER_VERSION = 1;

export function executiveStandupPdfStoragePath(
  organizationId: string,
  weekOf: string,
  version: number,
): string {
  return `${organizationId}/executive-standup/${weekOf}/v${version}/render-${EXECUTIVE_STANDUP_PACKET_RENDER_VERSION}/board-packet.pdf`;
}

export function riskSurveyBundlePdfStoragePath(
  organizationId: string,
  facilityId: string,
): string {
  return `${organizationId}/risk-survey-bundle/${facilityId}/render-${RISK_SURVEY_BUNDLE_RENDER_VERSION}/survey-bundle.pdf`;
}

export function executiveLeaguePdfStoragePath(
  organizationId: string,
): string {
  return `${organizationId}/executive-league/render-${EXECUTIVE_LEAGUE_RENDER_VERSION}/league.pdf`;
}

export function looksLikeStorageObjectPath(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/api/");
}
