#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function inferSection(metricKey) {
  if (["ar_goal_cents", "current_ar_cents", "current_total_census", "average_rent_cents", "uncollected_ar_total_cents"].includes(metricKey)) {
    return "ar_census";
  }
  if (["sp_female_beds_open", "sp_male_beds_open", "sp_flexible_beds_open", "private_beds_open", "total_beds_open"].includes(metricKey)) {
    return "bed_availability";
  }
  if (metricKey === "admissions_expected") return "admissions";
  if (["hospital_and_rehab_total", "expected_discharges"].includes(metricKey)) return "risk_management";
  if (["callouts_last_week", "terminations_last_week", "current_open_positions", "overtime_hours"].includes(metricKey)) {
    return "staffing";
  }
  return "marketing";
}

function parseCsv(content) {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) throw new Error("CSV file is empty.");
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ""])));
}

async function restRequest(method, route, { payload = undefined, query = undefined, headers = undefined } = {}) {
  const base = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`${base.replace(/\/$/, "")}/rest/v1/${route}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: payload == null ? undefined : JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${route} failed (${response.status}): ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchFacilityMap(organizationId) {
  const rows = await restRequest("GET", "facilities", {
    query: {
      organization_id: `eq.${organizationId}`,
      deleted_at: "is.null",
      select: "id,name",
    },
  });
  return new Map((rows ?? []).map((row) => [row.name, row.id]));
}

async function createImportJob(organizationId, fileName) {
  const rows = await restRequest("POST", "exec_standup_import_jobs", {
    payload: {
      organization_id: organizationId,
      source_file_name: fileName,
      source_kind: "csv",
      status: "running",
      started_at: new Date().toISOString(),
      source_ref_json: { import_mode: "csv" },
    },
    headers: { Prefer: "return=representation" },
  });
  return rows[0].id;
}

async function updateImportJob(importJobId, fields) {
  await restRequest("PATCH", "exec_standup_import_jobs", {
    payload: fields,
    query: { id: `eq.${importJobId}` },
    headers: { Prefer: "return=minimal" },
  });
}

async function upsertSnapshot(organizationId, weekOf, importJobId) {
  const existing = await restRequest("GET", "exec_standup_snapshots", {
    query: {
      organization_id: `eq.${organizationId}`,
      week_of: `eq.${weekOf}`,
      deleted_at: "is.null",
      select: "id",
    },
  });

  if (existing?.length) {
    const snapshotId = existing[0].id;
    await restRequest("DELETE", "exec_standup_snapshot_metrics", {
      query: { snapshot_id: `eq.${snapshotId}` },
      headers: { Prefer: "return=minimal" },
    });
    await restRequest("PATCH", "exec_standup_snapshots", {
      payload: {
        status: "published",
        confidence_band: "low",
        summary_json: { import_job_id: importJobId, imported: true, import_mode: "csv" },
      },
      query: { id: `eq.${snapshotId}` },
      headers: { Prefer: "return=minimal" },
    });
    return snapshotId;
  }

  const created = await restRequest("POST", "exec_standup_snapshots", {
    payload: {
      organization_id: organizationId,
      week_of: weekOf,
      status: "published",
      generated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      published_version: 1,
      confidence_band: "low",
      completeness_pct: 0,
      summary_json: { import_job_id: importJobId, imported: true, import_mode: "csv" },
    },
    headers: { Prefer: "return=representation" },
  });
  return created[0].id;
}

function normalizeRow(row, facilityMap, snapshotId, organizationId, importJobId, index) {
  const facilityName = row.facility_name?.trim() || "";
  const facilityId = facilityName && facilityName.toLowerCase() !== "total" ? facilityMap.get(facilityName) ?? null : null;
  if (facilityName && !facilityId && facilityName.toLowerCase() !== "total") {
    throw new Error(`Unknown facility_name '${facilityName}' on row ${index + 2}`);
  }

  const valueNumeric =
    row.value_numeric && row.value_numeric.trim() !== ""
      ? Number(row.value_numeric)
      : null;
  if (row.value_numeric && row.value_numeric.trim() !== "" && !Number.isFinite(valueNumeric)) {
    throw new Error(`Invalid value_numeric '${row.value_numeric}' on row ${index + 2}`);
  }

  return {
    snapshot_id: snapshotId,
    organization_id: organizationId,
    facility_id: facilityId,
    section_key: row.section_key?.trim() || inferSection(row.metric_key?.trim() || ""),
    metric_key: row.metric_key?.trim(),
    metric_label: row.metric_label?.trim() || row.metric_key?.trim(),
    value_numeric: valueNumeric,
    value_text: row.value_text?.trim() || (valueNumeric == null ? null : null),
    value_currency_code: "USD",
    source_mode: "manual",
    confidence_band: "low",
    totals_included: facilityId == null,
    freshness_at: null,
    source_ref_json: [{ row: index + 2, import_job_id: importJobId, import_mode: "csv" }],
    override_note: "Imported from CSV backfill.",
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: node scripts/import-executive-standup-csv.mjs <path/to/file.csv> [organization-id]");
  }

  const organizationId = process.argv[3] ?? process.env.HAVEN_ORGANIZATION_ID ?? DEFAULT_ORG_ID;
  const csv = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csv);
  const importJobId = await createImportJob(organizationId, path.basename(filePath));
  const facilityMap = await fetchFacilityMap(organizationId);

  let importedWeeks = 0;
  let importedMetrics = 0;

  try {
    const requiredColumns = ["week_of", "facility_name", "metric_key"];
    for (const column of requiredColumns) {
      if (!(column in rows[0])) {
        throw new Error(`CSV missing required column '${column}'`);
      }
    }

    const weekMap = new Map();
    for (const row of rows) {
      const weekOf = row.week_of?.trim();
      if (!weekOf) throw new Error("CSV row missing week_of");
      if (!weekMap.has(weekOf)) weekMap.set(weekOf, []);
      weekMap.get(weekOf).push(row);
    }

    for (const [weekOf, weekRows] of weekMap.entries()) {
      const snapshotId = await upsertSnapshot(organizationId, weekOf, importJobId);
      const metricRows = weekRows.map((row, index) =>
        normalizeRow(row, facilityMap, snapshotId, organizationId, importJobId, index),
      );
      if (metricRows.some((row) => !row.metric_key)) {
        throw new Error(`week ${weekOf}: one or more rows missing metric_key`);
      }

      await restRequest("POST", "exec_standup_snapshot_metrics", {
        payload: metricRows,
        headers: { Prefer: "return=minimal" },
      });

      const completeness =
        metricRows.length === 0
          ? 0
          : Math.round(
              (metricRows.filter((row) => row.value_numeric != null || row.value_text != null).length / metricRows.length) * 10000,
            ) / 100;

      await restRequest("PATCH", "exec_standup_snapshots", {
        payload: { completeness_pct: completeness },
        query: { id: `eq.${snapshotId}` },
        headers: { Prefer: "return=minimal" },
      });

      importedWeeks += 1;
      importedMetrics += metricRows.length;
    }

    await updateImportJob(importJobId, {
      status: "completed",
      imported_week_count: importedWeeks,
      imported_metric_count: importedMetrics,
      finished_at: new Date().toISOString(),
      result_json: { imported_weeks: importedWeeks, imported_metrics: importedMetrics, import_mode: "csv" },
    });
    console.log(JSON.stringify({ ok: true, importedWeeks, importedMetrics, importJobId }, null, 2));
  } catch (error) {
    await updateImportJob(importJobId, {
      status: "failed",
      error_text: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
