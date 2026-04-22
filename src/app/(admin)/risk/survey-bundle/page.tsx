"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileStack, ShieldCheck, Siren, Stamp } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { RiskHubNav } from "@/components/risk/RiskHubNav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { formatCents } from "@/lib/finance/format-cents";
import { loadRiskRoleContext } from "@/lib/risk/load-risk-context";
import {
  buildSurveyBundlePacket,
  classifyDocumentStatus,
  surveyBundleToMarkdown,
  type SurveyBundleAuditExport,
  type SurveyBundleDeficiency,
  type SurveyBundleDocument,
  type SurveyBundleIncident,
  type SurveyBundlePacket,
  type SurveyBundlePolicy,
  type SurveyBundleRenewalPacket,
  type SurveyBundleRiskSnapshot,
} from "@/lib/risk/survey-bundle";
import { useFacilityStore } from "@/hooks/useFacilityStore";

type FacilityRow = {
  id: string;
  entity_id: string;
  name: string;
  administrator_name: string | null;
  license_number: string | null;
  license_type: string;
  alf_license_type: string | null;
  total_licensed_beds: number;
};

type EntityRow = { id: string; name: string };

type RiskSnapshotRow = {
  id: string;
  snapshot_date: string;
  risk_score: number;
  risk_level: SurveyBundleRiskSnapshot["riskLevel"];
  score_delta: number | null;
  summary_json: { top_drivers?: SurveyBundleRiskSnapshot["topDrivers"] } | null;
};

type DeficiencyRow = {
  id: string;
  tag_number: string;
  tag_description: string;
  severity: string;
  status: string;
  survey_date: string;
  follow_up_survey_date: string | null;
  verified_at: string | null;
};

type PocRow = {
  deficiency_id: string;
  status: string;
  responsible_party: string;
  submission_due_date: string;
  completion_target_date: string;
};

type FacilityDocumentRow = {
  id: string;
  document_category: string;
  document_name: string;
  file_path: string;
  expiration_date: string | null;
  alert_yellow_days: number;
  alert_red_days: number;
};

type IncidentRow = {
  id: string;
  incident_number: string;
  occurred_at: string;
  severity: string;
  status: string;
  ahca_reportable: boolean;
  owner_notified: boolean;
  insurance_reportable: boolean;
};

type PolicyRow = {
  id: string;
  policy_number: string;
  carrier_name: string;
  policy_type: string;
  status: string;
  effective_date: string;
  expiration_date: string;
  premium_cents: number | null;
};

type RenewalPacketRow = {
  id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  narrative_reviewed_at: string | null;
  narrative_published_at: string | null;
};

type AuditExportRow = {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  row_count: number | null;
  sha256_checksum: string | null;
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

export default function RiskSurveyBundlePage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [packet, setPacket] = useState<SurveyBundlePacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadRiskRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      if (!facilityId) {
        setPacket(null);
        return;
      }

      const { data: facilityData, error: facilityError } = await supabase
        .from("facilities")
        .select("id, entity_id, name, administrator_name, license_number, license_type, alf_license_type, total_licensed_beds")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("id", facilityId)
        .maybeSingle();
      if (facilityError || !facilityData) throw new Error(facilityError?.message ?? "Facility not found.");

      const facilityRow = facilityData as FacilityRow;

      const [
        entityRes,
        riskRes,
        deficiencyRes,
        documentRes,
        incidentRes,
        policyRes,
        renewalPacketRes,
        auditRes,
      ] = await Promise.all([
        supabase
          .from("entities")
          .select("id, name")
          .eq("id", facilityRow.entity_id)
          .maybeSingle(),
        supabase
          .from("risk_score_snapshots" as never)
          .select("id, snapshot_date, risk_score, risk_level, score_delta, summary_json")
          .eq("organization_id" as never, ctx.ctx.organizationId as never)
          .eq("facility_id" as never, facilityId as never)
          .is("deleted_at" as never, null as never)
          .order("snapshot_date" as never, { ascending: false })
          .order("computed_at" as never, { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("survey_deficiencies")
          .select("id, tag_number, tag_description, severity, status, survey_date, follow_up_survey_date, verified_at")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .in("status", ["open", "poc_submitted", "poc_accepted", "recited"])
          .order("survey_date", { ascending: false })
          .limit(50),
        supabase
          .from("facility_documents" as never)
          .select("id, document_category, document_name, file_path, expiration_date, alert_yellow_days, alert_red_days")
          .eq("organization_id" as never, ctx.ctx.organizationId as never)
          .eq("facility_id" as never, facilityId as never)
          .is("deleted_at" as never, null as never)
          .order("expiration_date" as never, { ascending: true }),
        supabase
          .from("incidents")
          .select("id, incident_number, occurred_at, severity, status, ahca_reportable, owner_notified, insurance_reportable")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .in("status", ["open", "investigating"])
          .order("occurred_at", { ascending: false })
          .limit(25),
        supabase
          .from("insurance_policies")
          .select("id, policy_number, carrier_name, policy_type, status, effective_date, expiration_date, premium_cents")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("entity_id", facilityRow.entity_id)
          .is("deleted_at", null)
          .order("expiration_date", { ascending: true }),
        supabase
          .from("renewal_data_packages")
          .select("id, period_start, period_end, generated_at, narrative_reviewed_at, narrative_published_at")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("entity_id", facilityRow.entity_id)
          .is("deleted_at", null)
          .order("generated_at", { ascending: false })
          .limit(5),
        supabase
          .from("audit_log_export_jobs")
          .select("id, created_at, completed_at, status, row_count, sha256_checksum")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (entityRes.error) throw entityRes.error;
      if (riskRes.error) throw riskRes.error;
      if (deficiencyRes.error) throw deficiencyRes.error;
      if (documentRes.error) throw documentRes.error;
      if (incidentRes.error) throw incidentRes.error;
      if (policyRes.error) throw policyRes.error;
      if (renewalPacketRes.error) throw renewalPacketRes.error;
      if (auditRes.error) throw auditRes.error;

      const deficiencies = (deficiencyRes.data ?? []) as DeficiencyRow[];
      const deficiencyIds = deficiencies.map((row) => row.id);
      const { data: pocData, error: pocError } = deficiencyIds.length
        ? await supabase
            .from("plans_of_correction")
            .select("deficiency_id, status, responsible_party, submission_due_date, completion_target_date")
            .in("deficiency_id", deficiencyIds)
            .is("deleted_at", null)
            .in("status", ["draft", "submitted", "accepted"])
        : { data: [], error: null };
      if (pocError) throw pocError;

      const pocMap = new Map<string, PocRow>();
      for (const poc of (pocData ?? []) as PocRow[]) {
        if (!pocMap.has(poc.deficiency_id)) {
          pocMap.set(poc.deficiency_id, poc);
        }
      }

      const riskSnapshotRaw = riskRes.data as unknown as RiskSnapshotRow | null;
      const riskSnapshot: SurveyBundleRiskSnapshot | null = riskSnapshotRaw
        ? {
            snapshotDate: riskSnapshotRaw.snapshot_date,
            riskScore: riskSnapshotRaw.risk_score,
            riskLevel: riskSnapshotRaw.risk_level,
            scoreDelta: riskSnapshotRaw.score_delta,
            topDrivers: Array.isArray(riskSnapshotRaw.summary_json?.top_drivers)
              ? riskSnapshotRaw.summary_json.top_drivers
              : [],
          }
        : null;

      const surveyBundleDeficiencies: SurveyBundleDeficiency[] = deficiencies.map((row) => {
        const poc = pocMap.get(row.id);
        return {
          id: row.id,
          tagNumber: row.tag_number,
          tagDescription: row.tag_description,
          severity: row.severity,
          status: row.status,
          surveyDate: row.survey_date,
          followUpSurveyDate: row.follow_up_survey_date,
          verifiedAt: row.verified_at,
          pocStatus: poc?.status ?? null,
          pocResponsibleParty: poc?.responsible_party ?? null,
          pocSubmissionDueDate: poc?.submission_due_date ?? null,
          pocCompletionTargetDate: poc?.completion_target_date ?? null,
        };
      });

      const surveyBundleDocuments: SurveyBundleDocument[] = ((documentRes.data ?? []) as unknown as FacilityDocumentRow[]).map(
        (row) => {
          const classified = classifyDocumentStatus({
            expirationDate: row.expiration_date,
            yellowDays: Number(row.alert_yellow_days ?? 60),
            redDays: Number(row.alert_red_days ?? 30),
          });
          return {
            id: row.id,
            category: row.document_category,
            name: row.document_name,
            expirationDate: row.expiration_date,
            status: classified.status,
            daysToExpiration: classified.daysToExpiration,
            filePath: row.file_path,
          };
        },
      );

      const surveyBundleIncidents: SurveyBundleIncident[] = ((incidentRes.data ?? []) as IncidentRow[]).map((row) => ({
        id: row.id,
        incidentNumber: row.incident_number,
        occurredAt: row.occurred_at,
        severity: row.severity,
        status: row.status,
        ahcaReportable: row.ahca_reportable,
        ownerNotified: row.owner_notified,
        insuranceReportable: row.insurance_reportable,
      }));

      const surveyBundlePolicies: SurveyBundlePolicy[] = ((policyRes.data ?? []) as PolicyRow[]).map((row) => ({
        id: row.id,
        policyNumber: row.policy_number,
        carrierName: row.carrier_name,
        policyType: row.policy_type,
        status: row.status,
        effectiveDate: row.effective_date,
        expirationDate: row.expiration_date,
        premiumCents: row.premium_cents,
      }));

      const surveyBundleRenewalPackets: SurveyBundleRenewalPacket[] = ((renewalPacketRes.data ?? []) as RenewalPacketRow[]).map((row) => ({
        id: row.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        generatedAt: row.generated_at,
        reviewedAt: row.narrative_reviewed_at,
        publishedAt: row.narrative_published_at,
      }));

      const surveyBundleAuditExports: SurveyBundleAuditExport[] = ((auditRes.data ?? []) as AuditExportRow[]).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        status: row.status,
        rowCount: row.row_count,
        checksum: row.sha256_checksum,
      }));

      setPacket(
        buildSurveyBundlePacket({
          facility: {
            id: facilityRow.id,
            name: facilityRow.name,
            entityId: facilityRow.entity_id,
            entityName: (entityRes.data as EntityRow | null)?.name ?? null,
            administratorName: facilityRow.administrator_name,
            licenseNumber: facilityRow.license_number,
            licenseType: facilityRow.license_type,
            alfLicenseType: facilityRow.alf_license_type,
            totalLicensedBeds: facilityRow.total_licensed_beds,
          },
          riskSnapshot,
          deficiencies: surveyBundleDeficiencies,
          documents: surveyBundleDocuments,
          incidents: surveyBundleIncidents,
          policies: surveyBundlePolicies,
          renewalPackets: surveyBundleRenewalPackets,
          auditExports: surveyBundleAuditExports,
        }),
      );
    } catch (caughtError) {
      setPacket(null);
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load survey bundle.");
    } finally {
      setLoading(false);
    }
  }, [facilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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

      {!facilityId && !loading ? (
        <AdminEmptyState
          title="Choose a facility to assemble a packet"
          description="Survey bundles are facility-specific. Select a facility in the admin header, then reopen this page."
        />
      ) : null}

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      {loading ? <AdminTableLoadingState /> : null}

      {!loading && packet ? (
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
              tone={packet.riskSnapshot?.riskLevel === "critical" ? "red" : packet.riskSnapshot?.riskLevel === "high" ? "amber" : "indigo"}
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
                value={packet.facility.licenseNumber ? `${packet.facility.licenseNumber} · ${packet.facility.alfLicenseType ?? packet.facility.licenseType ?? ""}` : "—"}
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
                  Facility-doc vault expirations rolled into the bundle so the packet shows what is current, yellow, red, or missing an expiration date.
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
                        <span className={documentTone(document)}>
                          {document.status}
                        </span>
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
                        <p className="text-sm text-slate-600 dark:text-slate-400">No dominant overnight drivers recorded.</p>
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
