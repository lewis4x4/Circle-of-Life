export type SurveyBundleFacility = {
  id: string;
  name: string;
  entityId: string | null;
  entityName: string | null;
  administratorName: string | null;
  licenseNumber: string | null;
  licenseType: string | null;
  alfLicenseType: string | null;
  totalLicensedBeds: number;
};

export type SurveyBundleRiskSnapshot = {
  snapshotDate: string;
  riskScore: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  scoreDelta: number | null;
  topDrivers: Array<{
    key: string;
    label: string;
    count: number;
    penalty: number;
    detail: string;
  }>;
};

export type SurveyBundleDeficiency = {
  id: string;
  tagNumber: string;
  tagDescription: string;
  severity: string;
  status: string;
  surveyDate: string;
  followUpSurveyDate: string | null;
  verifiedAt: string | null;
  pocStatus: string | null;
  pocResponsibleParty: string | null;
  pocSubmissionDueDate: string | null;
  pocCompletionTargetDate: string | null;
};

export type SurveyBundleDocument = {
  id: string;
  category: string;
  name: string;
  expirationDate: string | null;
  status: "current" | "yellow" | "red" | "missing_expiration";
  daysToExpiration: number | null;
  filePath: string;
};

export type SurveyBundleIncident = {
  id: string;
  incidentNumber: string;
  occurredAt: string;
  severity: string;
  status: string;
  ahcaReportable: boolean;
  ownerNotified: boolean;
  insuranceReportable: boolean;
};

export type SurveyBundlePolicy = {
  id: string;
  policyNumber: string;
  carrierName: string;
  policyType: string;
  status: string;
  effectiveDate: string;
  expirationDate: string;
  premiumCents: number | null;
};

export type SurveyBundleRenewalPacket = {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
};

export type SurveyBundleAuditExport = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  rowCount: number | null;
  checksum: string | null;
};

export type SurveyBundlePacket = {
  generatedAt: string;
  facility: SurveyBundleFacility;
  packetCoveragePct: number;
  readinessSummary: {
    openDeficiencies: number;
    docsAtRisk: number;
    openIncidents: number;
    ahcaReportableOpenIncidents: number;
    activePolicies: number;
    latestAuditExportStatus: string | null;
  };
  riskSnapshot: SurveyBundleRiskSnapshot | null;
  deficiencies: SurveyBundleDeficiency[];
  documents: SurveyBundleDocument[];
  incidents: SurveyBundleIncident[];
  policies: SurveyBundlePolicy[];
  renewalPackets: SurveyBundleRenewalPacket[];
  auditExports: SurveyBundleAuditExport[];
  recommendedActions: string[];
};

function daysToExpiration(expirationDate: string) {
  const today = new Date();
  const due = new Date(`${expirationDate}T12:00:00.000Z`);
  return Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
}

export function classifyDocumentStatus(args: {
  expirationDate: string | null;
  yellowDays: number;
  redDays: number;
}): { status: SurveyBundleDocument["status"]; daysToExpiration: number | null } {
  if (!args.expirationDate) {
    return { status: "missing_expiration", daysToExpiration: null };
  }

  const days = daysToExpiration(args.expirationDate);
  if (days <= args.redDays) {
    return { status: "red", daysToExpiration: days };
  }
  if (days <= args.yellowDays) {
    return { status: "yellow", daysToExpiration: days };
  }
  return { status: "current", daysToExpiration: days };
}

function statusLine(item: SurveyBundleDocument) {
  if (item.status === "missing_expiration") return `${item.name}: expiration missing`;
  return `${item.name}: ${item.expirationDate} (${item.daysToExpiration} day${item.daysToExpiration === 1 ? "" : "s"})`;
}

export function buildSurveyBundlePacket(args: {
  facility: SurveyBundleFacility;
  riskSnapshot: SurveyBundleRiskSnapshot | null;
  deficiencies: SurveyBundleDeficiency[];
  documents: SurveyBundleDocument[];
  incidents: SurveyBundleIncident[];
  policies: SurveyBundlePolicy[];
  renewalPackets: SurveyBundleRenewalPacket[];
  auditExports: SurveyBundleAuditExport[];
}): SurveyBundlePacket {
  const docsAtRisk = args.documents.filter((document) => document.status === "red" || document.status === "yellow");
  const ahcaReportableOpenIncidents = args.incidents.filter((incident) => incident.ahcaReportable).length;

  const coverageSections = [
    Boolean(args.riskSnapshot),
    args.documents.length > 0,
    args.policies.length > 0,
    args.auditExports.length > 0,
    args.deficiencies.length >= 0,
  ];
  const packetCoveragePct = Math.round(
    (coverageSections.filter(Boolean).length / coverageSections.length) * 100,
  );

  const recommendedActions: string[] = [];
  if (!args.riskSnapshot) {
    recommendedActions.push("Run the nightly risk scorer so the packet includes a current cross-domain risk snapshot.");
  } else if (args.riskSnapshot.riskLevel === "critical" || args.riskSnapshot.riskLevel === "high") {
    recommendedActions.push(
      `Address the top overnight risk driver first: ${args.riskSnapshot.topDrivers[0]?.detail ?? "nightly score is elevated."}`,
    );
  }
  if (args.deficiencies.some((deficiency) => deficiency.pocStatus == null)) {
    recommendedActions.push("Draft or attach a plan of correction for every open survey deficiency before packet export.");
  }
  if (docsAtRisk.length > 0) {
    recommendedActions.push(
      `Refresh expiring evidence documents: ${docsAtRisk.slice(0, 3).map((document) => document.name).join(", ")}.`,
    );
  }
  if (args.auditExports[0]?.status !== "completed") {
    recommendedActions.push("Generate a fresh audit-log export so the packet includes recent immutable evidence.");
  }
  if (args.renewalPackets.length === 0) {
    recommendedActions.push("Generate a renewal data package to attach the current insurance/legal packet.");
  }

  return {
    generatedAt: new Date().toISOString(),
    facility: args.facility,
    packetCoveragePct,
    readinessSummary: {
      openDeficiencies: args.deficiencies.length,
      docsAtRisk: docsAtRisk.length,
      openIncidents: args.incidents.length,
      ahcaReportableOpenIncidents,
      activePolicies: args.policies.filter((policy) => policy.status === "active").length,
      latestAuditExportStatus: args.auditExports[0]?.status ?? null,
    },
    riskSnapshot: args.riskSnapshot,
    deficiencies: args.deficiencies,
    documents: args.documents,
    incidents: args.incidents,
    policies: args.policies,
    renewalPackets: args.renewalPackets,
    auditExports: args.auditExports,
    recommendedActions,
  };
}

export function surveyBundleToMarkdown(packet: SurveyBundlePacket) {
  const lines: string[] = [
    `# AHCA Survey Bundle — ${packet.facility.name}`,
    "",
    `Generated: ${packet.generatedAt}`,
    `Facility: ${packet.facility.name}`,
    `Entity: ${packet.facility.entityName ?? "Unknown entity"}`,
    `Administrator: ${packet.facility.administratorName ?? "Unknown"}`,
    `License: ${packet.facility.licenseNumber ?? "Missing"} (${packet.facility.alfLicenseType ?? packet.facility.licenseType ?? "unspecified"})`,
    `Licensed beds: ${packet.facility.totalLicensedBeds}`,
    `Packet coverage: ${packet.packetCoveragePct}%`,
    "",
    "## Readiness Summary",
    `- Open deficiencies: ${packet.readinessSummary.openDeficiencies}`,
    `- Documents at risk: ${packet.readinessSummary.docsAtRisk}`,
    `- Open incidents: ${packet.readinessSummary.openIncidents}`,
    `- AHCA-reportable open incidents: ${packet.readinessSummary.ahcaReportableOpenIncidents}`,
    `- Active policies: ${packet.readinessSummary.activePolicies}`,
    `- Latest audit export: ${packet.readinessSummary.latestAuditExportStatus ?? "none"}`,
    "",
    "## Risk Snapshot",
  ];

  if (packet.riskSnapshot) {
    lines.push(
      `- Score: ${packet.riskSnapshot.riskScore}/100 (${packet.riskSnapshot.riskLevel})`,
      `- Snapshot date: ${packet.riskSnapshot.snapshotDate}`,
      `- Score delta: ${packet.riskSnapshot.scoreDelta ?? 0}`,
      "- Top drivers:",
      ...packet.riskSnapshot.topDrivers.map((driver) => `  - ${driver.label}: ${driver.detail}`),
    );
  } else {
    lines.push("- No nightly risk snapshot available.");
  }

  lines.push("", "## Survey Deficiencies");
  if (packet.deficiencies.length === 0) {
    lines.push("- None open.");
  } else {
    for (const deficiency of packet.deficiencies) {
      lines.push(
        `- ${deficiency.tagNumber} — ${deficiency.tagDescription} | severity=${deficiency.severity} | status=${deficiency.status} | POC=${deficiency.pocStatus ?? "missing"} | due=${deficiency.pocSubmissionDueDate ?? "n/a"}`,
      );
    }
  }

  lines.push("", "## Evidence Documents");
  if (packet.documents.length === 0) {
    lines.push("- No facility evidence documents found.");
  } else {
    for (const document of packet.documents) {
      lines.push(`- ${statusLine(document)}`);
    }
  }

  lines.push("", "## Open Incidents");
  if (packet.incidents.length === 0) {
    lines.push("- None open or investigating.");
  } else {
    for (const incident of packet.incidents) {
      lines.push(
        `- ${incident.incidentNumber} | ${incident.severity} | status=${incident.status} | AHCA reportable=${incident.ahcaReportable ? "yes" : "no"} | occurred=${incident.occurredAt}`,
      );
    }
  }

  lines.push("", "## Insurance / Legal Packet");
  if (packet.policies.length === 0) {
    lines.push("- No active policy inventory found.");
  } else {
    for (const policy of packet.policies) {
      lines.push(
        `- ${policy.policyNumber} — ${policy.carrierName} | ${policy.policyType} | status=${policy.status} | expires=${policy.expirationDate}`,
      );
    }
  }
  if (packet.renewalPackets.length === 0) {
    lines.push("- No renewal data packages generated.");
  } else {
    lines.push(
      ...packet.renewalPackets.map(
        (packetRow) =>
          `- Renewal packet ${packetRow.periodStart} → ${packetRow.periodEnd} | generated=${packetRow.generatedAt} | reviewed=${packetRow.reviewedAt ?? "no"} | published=${packetRow.publishedAt ?? "no"}`,
      ),
    );
  }

  lines.push("", "## Audit Evidence");
  if (packet.auditExports.length === 0) {
    lines.push("- No recent audit export jobs.");
  } else {
    lines.push(
      ...packet.auditExports.map(
        (auditJob) =>
          `- ${auditJob.createdAt} | status=${auditJob.status} | rows=${auditJob.rowCount ?? "n/a"} | completed=${auditJob.completedAt ?? "n/a"}`,
      ),
    );
  }

  lines.push("", "## Recommended Actions");
  if (packet.recommendedActions.length === 0) {
    lines.push("- None. Packet is assembled from current system state.");
  } else {
    lines.push(...packet.recommendedActions.map((action) => `- ${action}`));
  }

  return lines.join("\n");
}
