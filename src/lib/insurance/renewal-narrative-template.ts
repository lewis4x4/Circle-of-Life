/**
 * Deterministic renewal narrative when OpenAI is unavailable (dev / outage).
 * Module 18 Enhanced — must still be human-reviewed before external use.
 */
import type { RenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
import { formatUsdFromCents } from "@/lib/insurance/format-money";

export function buildTemplateRenewalNarrative(
  payload: RenewalPackagePayload,
  policy: { policy_number: string; carrier_name: string },
): string {
  const m = payload.metrics;
  return [
    `Renewal underwriting snapshot (${payload.period.start} through ${payload.period.end}) for policy ${policy.policy_number} with carrier ${policy.carrier_name}.`,
    `Operational metrics from Haven: active residents ${m.active_residents}; active staff ${m.active_staff}; incidents occurring in the period ${m.incidents_in_period}.`,
    `Invoice totals overlapping the package period (system integer cents): ${formatUsdFromCents(m.invoice_total_cents)}.`,
    `This text is a template draft assembled from internal metrics only. A qualified reviewer must edit, approve, and publish before any external use.`,
  ].join("\n\n");
}
