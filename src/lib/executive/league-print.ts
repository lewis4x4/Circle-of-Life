import type { ExecutiveLeagueData } from "@/lib/executive/load-league-data";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function buildExecutiveLeaguePrintHtml(data: ExecutiveLeagueData) {
  const topRows = data.rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.facilityName)}</td>
          <td>${escapeHtml(row.entityName)}</td>
          <td>${row.leagueScore}/100</td>
          <td>${escapeHtml(row.leagueLabel)}</td>
          <td>${row.riskScore == null ? "—" : `${row.riskScore}/100`}</td>
          <td>${row.occupancyPct == null ? "—" : `${row.occupancyPct}%`}</td>
          <td>${escapeHtml(row.primaryConcern)}</td>
        </tr>`,
    )
    .join("");

  const insuranceRows = data.insuranceRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.entityName)}</td>
          <td>${row.readinessScore}/100</td>
          <td>${escapeHtml(row.readinessLabel)}</td>
          <td>${row.activePolicies}</td>
          <td>${row.expiringPolicies60d}</td>
          <td>${row.pendingRenewals}</td>
          <td>${escapeHtml(row.primaryConcern)}</td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Executive League</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; padding: 24px; }
      h1, h2 { margin: 0 0 12px; }
      h1 { font-size: 28px; }
      h2 { font-size: 18px; margin-top: 28px; }
      p, td, th { font-size: 12px; line-height: 1.5; }
      .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; background: #fff; }
      .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #6b7280; }
      .metric-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      @media print { body { padding: 8px; } }
    </style>
  </head>
  <body>
    <h1>Executive League Table</h1>
    <p>Generated ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="summary">
      <div class="card"><div class="metric-label">Published week</div><div class="metric-value">${escapeHtml(data.boardSummary.weekOf ?? "None")}</div></div>
      <div class="card"><div class="metric-label">Packet confidence</div><div class="metric-value">${escapeHtml(data.boardSummary.confidenceBand ?? "—")}</div></div>
      <div class="card"><div class="metric-label">Saved packets</div><div class="metric-value">${data.boardSummary.savedPacketCount}</div></div>
      <div class="card"><div class="metric-label">Entities ready</div><div class="metric-value">${data.insuranceRows.filter((row) => row.readinessLabel === "ready").length}/${data.insuranceRows.length}</div></div>
    </div>

    <h2>Facility League</h2>
    <table>
      <thead>
        <tr><th>Facility</th><th>Entity</th><th>League</th><th>Label</th><th>Risk</th><th>Occupancy</th><th>Primary Concern</th></tr>
      </thead>
      <tbody>${topRows}</tbody>
    </table>

    <h2>Insurance Readiness</h2>
    <table>
      <thead>
        <tr><th>Entity</th><th>Score</th><th>Label</th><th>Active Policies</th><th>Expiring 60d</th><th>Open Renewals</th><th>Primary Concern</th></tr>
      </thead>
      <tbody>${insuranceRows}</tbody>
    </table>
  </body>
</html>`;
}
