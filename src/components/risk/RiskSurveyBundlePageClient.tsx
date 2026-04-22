"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileStack, ShieldCheck, Siren, Stamp } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
} from "@/components/common/admin-list-patterns";
import { RiskHubNav } from "@/components/risk/RiskHubNav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadBlobFromUrl } from "@/lib/download-blob";
import { formatCents } from "@/lib/finance/format-cents";
import {
  surveyBundleToMarkdown,
  type SurveyBundleDocument,
  type SurveyBundlePacket,
} from "@/lib/risk/survey-bundle";

type RiskSurveyBundlePageClientProps = {
  initialPacket: SurveyBundlePacket | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function documentTone(document: SurveyBundleDocument) {
  if (document.status === "red") return "text-red-600 dark:text-red-400";
  if (document.status === "yellow") return "text-amber-600 dark:text-amber-400";
  if (document.status === "missing_expiration") return "text-slate-600 dark:text-slate-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export default function RiskSurveyBundlePageClient({
  initialPacket,
  initialError,
  initialFacilityId,
}: RiskSurveyBundlePageClientProps) {
  const router = useRouter();
  const packet: SurveyBundlePacket | null = initialPacket;
  const error = initialError;
  const facilityId = initialFacilityId;
  const packetMarkdown = useMemo(() => (packet ? surveyBundleToMarkdown(packet) : null), [packet]);

  return (
    <div className="space-y-6">
      <RiskHubNav />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            AHCA survey bundle and legal packet
          </p>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Survey bundle</h1>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Assemble the current regulatory story for one facility from live deficiencies, plans of correction,
              facility evidence documents, incident posture, insurance packet status, and immutable audit exports.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!packet}
            onClick={() => {
              if (!packet) return;
              void downloadBlobFromUrl(
                `/api/risk/survey-bundle/${encodeURIComponent(packet.facility.id)}/pdf`,
                `${packet.facility.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-survey-bundle.pdf`,
              );
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!packet}
            onClick={() => {
              if (!packet) return;
              downloadText(
                `${packet.facility.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-survey-bundle.json`,
                JSON.stringify(packet, null, 2),
                "application/json",
              );
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!packetMarkdown || !packet}
            onClick={() => {
              if (!packet || !packetMarkdown) return;
              downloadText(
                `${packet.facility.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-survey-bundle.md`,
                packetMarkdown,
                "text/markdown",
              );
            }}
          >
            <FileStack className="mr-2 h-4 w-4" />
            Markdown
          </Button>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/compliance/audit-export">
            Audit export
          </Link>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/insurance/renewal-packages">
            Renewal packages
          </Link>
        </div>
      </div>

      {!facilityId ? (
        <AdminEmptyState
          title="Choose a facility to assemble a packet"
          description="Survey bundles are facility-specific. Select a facility in the admin header, then reopen this page."
        />
      ) : null}

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => router.refresh()} /> : null}

      {packet ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <BundleMetricCard
              icon={ShieldCheck}
              label="Packet coverage"
              value={`${packet.packetCoveragePct}%`}
              detail={`${packet.facility.name} · ${packet.facility.totalLicensedBeds} licensed beds`}
            />
            <BundleMetricCard
              icon={Siren}
              label="Open deficiencies"
              value={String(packet.readinessSummary.openDeficiencies)}
              detail={`Docs at risk: ${packet.readinessSummary.docsAtRisk}`}
              tone={packet.readinessSummary.openDeficiencies > 0 ? "amber" : "emerald"}
            />
            <BundleMetricCard
              icon={Stamp}
              label="Risk score"
              value={packet.riskSnapshot ? `${packet.riskSnapshot.riskScore}/100` : "—"}
              detail={packet.riskSnapshot ? packet.riskSnapshot.riskLevel : "Nightly scorer not run"}
              tone={
                packet.riskSnapshot?.riskLevel === "critical"
                  ? "red"
                  : packet.riskSnapshot?.riskLevel === "high"
                    ? "amber"
                    : "indigo"
              }
            />
            <BundleMetricCard
              icon={FileStack}
              label="Legal packet"
              value={String(packet.renewalPackets.length)}
              detail={`${packet.readinessSummary.activePolicies} active polic${packet.readinessSummary.activePolicies === 1 ? "y" : "ies"}`}
              tone={packet.renewalPackets.length > 0 ? "indigo" : "amber"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Facility record</CardTitle>
              <CardDescription>
                Base identity for the packet. This is the opening section a regulator or carrier reviewer sees.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <PacketValue label="Facility" value={packet.facility.name} />
              <PacketValue label="Entity" value={packet.facility.entityName ?? "—"} />
              <PacketValue label="Administrator" value={packet.facility.administratorName ?? "—"} />
              <PacketValue
                label="License"
                value={
                  packet.facility.licenseNumber
                    ? `${packet.facility.licenseNumber} · ${packet.facility.alfLicenseType ?? packet.facility.licenseType ?? ""}`
                    : "—"
                }
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle>Deficiencies and plans of correction</CardTitle>
                <CardDescription>
                  Current survey findings with the responsible party and the next due date for correction work.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {packet.deficiencies.length === 0 ? (
                  <AdminEmptyState
                    title="No open deficiencies"
                    description="No open survey deficiencies or active plans of correction were found for this facility."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800">
                          <th className="pb-2 pr-4 font-medium">Tag</th>
                          <th className="pb-2 pr-4 font-medium">Severity</th>
                          <th className="pb-2 pr-4 font-medium">Status</th>
                          <th className="pb-2 pr-4 font-medium">POC</th>
                          <th className="pb-2 pr-4 font-medium">Submission due</th>
                          <th className="pb-2 font-medium">Responsible party</th>
                        </tr>
                      </thead>
                      <tbody>
                        {packet.deficiencies.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 dark:border-slate-900">
                            <td className="py-3 pr-4">
                              <div className="font-medium">{row.tagNumber}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{row.tagDescription}</div>
                            </td>
                            <td className="py-3 pr-4">{row.severity}</td>
                            <td className="py-3 pr-4">{row.status}</td>
                            <td className="py-3 pr-4">{row.pocStatus ?? "Missing"}</td>
                            <td className="py-3 pr-4">{row.pocSubmissionDueDate ?? "—"}</td>
                            <td className="py-3">{row.pocResponsibleParty ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evidence documents</CardTitle>
                <CardDescription>
                  Facility-doc vault expirations rolled into the bundle so the packet shows what is current, yellow,
                  red, or missing an expiration date.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {packet.documents.length === 0 ? (
                  <AdminEmptyState
                    title="No facility documents"
                    description="The evidence vault is empty for this facility, so the packet has no document backing yet."
                  />
                ) : (
                  packet.documents.slice(0, 12).map((document) => (
                    <div
                      key={document.id}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{document.name}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            {document.category.replaceAll("_", " ")}
                          </p>
                        </div>
                        <span className={documentTone(document)}>{document.status}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        {document.expirationDate
                          ? `${document.expirationDate} · ${document.daysToExpiration} day${document.daysToExpiration === 1 ? "" : "s"}`
                          : "Expiration date missing"}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
            <Card>
              <CardHeader>
                <CardTitle>Incident and risk posture</CardTitle>
                <CardDescription>
                  Open incident exposure paired with the latest nightly risk drivers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <PacketValue label="Open incidents" value={String(packet.readinessSummary.openIncidents)} />
                  <PacketValue
                    label="AHCA reportable"
                    value={String(packet.readinessSummary.ahcaReportableOpenIncidents)}
                  />
                </div>
                {packet.riskSnapshot ? (
                  <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                    <p className="font-medium text-slate-900 dark:text-white">
                      Nightly risk: {packet.riskSnapshot.riskScore}/100 ({packet.riskSnapshot.riskLevel})
                    </p>
                    <div className="mt-3 space-y-2">
                      {packet.riskSnapshot.topDrivers.length === 0 ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No dominant overnight drivers recorded.
                        </p>
                      ) : (
                        packet.riskSnapshot.topDrivers.map((driver) => (
                          <div key={driver.key} className="rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-slate-900/70">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium text-slate-900 dark:text-white">{driver.label}</span>
                              <span className="text-slate-600 dark:text-slate-400">-{driver.penalty}</span>
                            </div>
                            <p className="mt-1 text-slate-600 dark:text-slate-400">{driver.detail}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <AdminEmptyState
                    title="Nightly risk not available"
                    description="The risk command does not have a current nightly score for this facility yet."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Insurance and legal packet</CardTitle>
                <CardDescription>
                  Active policy inventory plus the latest renewal data packages that can accompany the survey packet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <PacketValue label="Active policies" value={String(packet.readinessSummary.activePolicies)} />
                  <PacketValue label="Renewal packets" value={String(packet.renewalPackets.length)} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="pb-2 pr-4 font-medium">Policy</th>
                        <th className="pb-2 pr-4 font-medium">Carrier</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Expires</th>
                        <th className="pb-2 font-medium">Premium</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packet.policies.map((policy) => (
                        <tr key={policy.id} className="border-b border-slate-100 dark:border-slate-900">
                          <td className="py-3 pr-4">{policy.policyNumber}</td>
                          <td className="py-3 pr-4">{policy.carrierName}</td>
                          <td className="py-3 pr-4">{policy.status}</td>
                          <td className="py-3 pr-4">{policy.expirationDate}</td>
                          <td className="py-3">{policy.premiumCents != null ? formatCents(policy.premiumCents) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {packet.renewalPackets.length > 0 ? (
                  <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                    <p className="font-medium text-slate-900 dark:text-white">Latest packet</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {packet.renewalPackets[0].periodStart} → {packet.renewalPackets[0].periodEnd}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      Generated {packet.renewalPackets[0].generatedAt}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recommended actions</CardTitle>
              <CardDescription>
                Packet-specific next steps generated from live evidence gaps in this facility.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {packet.recommendedActions.length === 0 ? (
                <AdminEmptyState
                  title="No immediate packet gaps"
                  description="The current packet is assembled from system data without any obvious missing sections."
                />
              ) : (
                <ul className="space-y-3">
                  {packet.recommendedActions.map((action) => (
                    <li
                      key={action}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300"
                    >
                      {action}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function BundleMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "indigo",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail: string;
  tone?: "indigo" | "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-200/80 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20"
      : tone === "amber"
        ? "border-amber-200/80 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
        : tone === "emerald"
          ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-indigo-200/80 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20";

  return (
    <Card className={toneClass}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{detail}</p>
        </div>
        <div className="rounded-xl border border-white/50 bg-white/70 p-3 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function PacketValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-base font-medium text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
