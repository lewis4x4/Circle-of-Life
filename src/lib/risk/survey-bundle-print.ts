import type { SurveyBundlePacket } from "@/lib/risk/survey-bundle";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function buildSurveyBundlePrintHtml(packet: SurveyBundlePacket) {
  const deficiencyRows = packet.deficiencies.length
    ? packet.deficiencies
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.tagNumber)}</td>
              <td>${escapeHtml(row.tagDescription)}</td>
              <td>${escapeHtml(row.severity)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${escapeHtml(row.pocStatus ?? "Missing")}</td>
              <td>${escapeHtml(row.pocSubmissionDueDate ?? "—")}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="6">No open deficiencies.</td></tr>`;

  const documentRows = packet.documents.length
    ? packet.documents
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(row.category.replaceAll("_", " "))}</td>
              <td>${escapeHtml(row.expirationDate ?? "Missing")}</td>
              <td>${escapeHtml(row.status)}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No evidence documents found.</td></tr>`;

  const incidentRows = packet.incidents.length
    ? packet.incidents
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.incidentNumber)}</td>
              <td>${escapeHtml(row.severity)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${row.ahcaReportable ? "Yes" : "No"}</td>
              <td>${escapeHtml(new Date(row.occurredAt).toLocaleString())}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No open incidents.</td></tr>`;

  const policyRows = packet.policies.length
    ? packet.policies
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.policyNumber)}</td>
              <td>${escapeHtml(row.carrierName)}</td>
              <td>${escapeHtml(row.policyType)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${escapeHtml(row.expirationDate)}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No policy inventory found.</td></tr>`;

  const driverLines = packet.riskSnapshot?.topDrivers.length
    ? packet.riskSnapshot.topDrivers.map((driver) => `<li>${escapeHtml(driver.label)}: ${escapeHtml(driver.detail)}</li>`).join("")
    : "<li>No dominant overnight drivers recorded.</li>";

  const actionLines = packet.recommendedActions.length
    ? packet.recommendedActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")
    : "<li>No immediate packet gaps.</li>";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AHCA Survey Bundle — ${escapeHtml(packet.facility.name)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; padding: 24px; }
      h1, h2, h3 { margin: 0 0 12px; }
      h1 { font-size: 28px; }
      h2 { font-size: 18px; margin-top: 28px; }
      p, li, td, th { font-size: 12px; line-height: 1.5; }
      .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; background: #fff; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      ul { margin: 8px 0 0 18px; padding: 0; }
      .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
      .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #6b7280; }
      .metric-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
      @media print { body { padding: 8px; } }
    </style>
  </head>
  <body>
    <h1>AHCA Survey Bundle</h1>
    <p>${escapeHtml(packet.facility.name)} · Generated ${escapeHtml(new Date(packet.generatedAt).toLocaleString())}</p>
    <div class="meta-grid">
      <div class="card"><strong>Entity</strong><br />${escapeHtml(packet.facility.entityName ?? "—")}</div>
      <div class="card"><strong>Administrator</strong><br />${escapeHtml(packet.facility.administratorName ?? "—")}</div>
      <div class="card"><strong>License</strong><br />${escapeHtml(packet.facility.licenseNumber ?? "Missing")} (${escapeHtml(packet.facility.alfLicenseType ?? packet.facility.licenseType ?? "unspecified")})</div>
      <div class="card"><strong>Licensed beds</strong><br />${packet.facility.totalLicensedBeds}</div>
    </div>

    <div class="summary">
      <div class="card"><div class="metric-label">Packet coverage</div><div class="metric-value">${packet.packetCoveragePct}%</div></div>
      <div class="card"><div class="metric-label">Open deficiencies</div><div class="metric-value">${packet.readinessSummary.openDeficiencies}</div></div>
      <div class="card"><div class="metric-label">Risk score</div><div class="metric-value">${packet.riskSnapshot ? `${packet.riskSnapshot.riskScore}/100` : "—"}</div></div>
    </div>

    <h2>Risk Snapshot</h2>
    <div class="card">
      <p>Score: ${packet.riskSnapshot ? `${packet.riskSnapshot.riskScore}/100 (${escapeHtml(packet.riskSnapshot.riskLevel)})` : "No nightly risk snapshot available."}</p>
      <ul>${driverLines}</ul>
    </div>

    <h2>Deficiencies and Plans of Correction</h2>
    <table>
      <thead>
        <tr><th>Tag</th><th>Description</th><th>Severity</th><th>Status</th><th>POC</th><th>Submission Due</th></tr>
      </thead>
      <tbody>${deficiencyRows}</tbody>
    </table>

    <h2>Evidence Documents</h2>
    <table>
      <thead>
        <tr><th>Document</th><th>Category</th><th>Expiration</th><th>Status</th></tr>
      </thead>
      <tbody>${documentRows}</tbody>
    </table>

    <h2>Open Incidents</h2>
    <table>
      <thead>
        <tr><th>Incident</th><th>Severity</th><th>Status</th><th>AHCA Reportable</th><th>Occurred</th></tr>
      </thead>
      <tbody>${incidentRows}</tbody>
    </table>

    <h2>Insurance and Legal Packet</h2>
    <table>
      <thead>
        <tr><th>Policy</th><th>Carrier</th><th>Type</th><th>Status</th><th>Expires</th></tr>
      </thead>
      <tbody>${policyRows}</tbody>
    </table>

    <h2>Recommended Actions</h2>
    <div class="card">
      <ul>${actionLines}</ul>
    </div>
  </body>
</html>`;
}
