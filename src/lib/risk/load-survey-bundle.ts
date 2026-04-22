import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import {
  buildSurveyBundlePacket,
  classifyDocumentStatus,
  type SurveyBundleAuditExport,
  type SurveyBundleDeficiency,
  type SurveyBundleDocument,
  type SurveyBundleIncident,
  type SurveyBundlePacket,
  type SurveyBundlePolicy,
  type SurveyBundleRenewalPacket,
  type SurveyBundleRiskSnapshot,
} from "@/lib/risk/survey-bundle";

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

export async function loadSurveyBundlePacket(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string,
): Promise<SurveyBundlePacket> {
  const { data: facilityData, error: facilityError } = await supabase
    .from("facilities")
    .select("id, entity_id, name, administrator_name, license_number, license_type, alf_license_type, total_licensed_beds")
    .eq("organization_id", organizationId)
    .eq("id", facilityId)
    .maybeSingle();
  if (facilityError || !facilityData) {
    throw new Error(facilityError?.message ?? "Facility not found.");
  }

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
      .eq("organization_id" as never, organizationId as never)
      .eq("facility_id" as never, facilityId as never)
      .is("deleted_at" as never, null as never)
      .order("snapshot_date" as never, { ascending: false })
      .order("computed_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("survey_deficiencies")
      .select("id, tag_number, tag_description, severity, status, survey_date, follow_up_survey_date, verified_at")
      .eq("organization_id", organizationId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .in("status", ["open", "poc_submitted", "poc_accepted", "recited"])
      .order("survey_date", { ascending: false })
      .limit(50),
    supabase
      .from("facility_documents" as never)
      .select("id, document_category, document_name, file_path, expiration_date, alert_yellow_days, alert_red_days")
      .eq("organization_id" as never, organizationId as never)
      .eq("facility_id" as never, facilityId as never)
      .is("deleted_at" as never, null as never)
      .order("expiration_date" as never, { ascending: true }),
    supabase
      .from("incidents")
      .select("id, incident_number, occurred_at, severity, status, ahca_reportable, owner_notified, insurance_reportable")
      .eq("organization_id", organizationId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .in("status", ["open", "investigating"])
      .order("occurred_at", { ascending: false })
      .limit(25),
    supabase
      .from("insurance_policies")
      .select("id, policy_number, carrier_name, policy_type, status, effective_date, expiration_date, premium_cents")
      .eq("organization_id", organizationId)
      .eq("entity_id", facilityRow.entity_id)
      .is("deleted_at", null)
      .order("expiration_date", { ascending: true }),
    supabase
      .from("renewal_data_packages")
      .select("id, period_start, period_end, generated_at, narrative_reviewed_at, narrative_published_at")
      .eq("organization_id", organizationId)
      .eq("entity_id", facilityRow.entity_id)
      .is("deleted_at", null)
      .order("generated_at", { ascending: false })
      .limit(5),
    supabase
      .from("audit_log_export_jobs")
      .select("id, created_at, completed_at, status, row_count, sha256_checksum")
      .eq("organization_id", organizationId)
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

  const surveyBundleDocuments: SurveyBundleDocument[] = ((documentRes.data ?? []) as unknown as FacilityDocumentRow[]).map((row) => {
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
  });

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

  return buildSurveyBundlePacket({
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
  });
}
